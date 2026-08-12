-- ===========================================================================
--  Vessel trending & wash-trade detection
--  Apply against the Postgres schema Ponder writes to (set search_path first,
--  e.g.  SET search_path TO <ponder_schema>, public;).
--
--  Design principle: DO NOT rank on raw volume. Raw volume is trivially wash-
--  traded. We rank on a time-decayed blend of *unique buyers*, *holder count*
--  and *settled* volume, then multiply by (1 - wash_penalty) where the penalty
--  is derived from the transfer graph. Rankings live here, in SQL — not in the
--  API layer.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Transfer-graph wash signals
--    We look only at genuine wallet-to-wallet transfers (exclude mint/burn).
--    Two independent smells:
--      * reciprocity  — value sloshing back and forth between the same wallets
--                       (A->B and B->A both present): the classic wash loop.
--      * concentration— very few distinct wallets generating many transfers:
--                       a tight cluster trading with itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_wash_signals AS
WITH tx AS (
    SELECT collection,
           lower("from") AS f,
           lower("to")   AS t
    FROM transfer_event
    WHERE "from" <> '0x0000000000000000000000000000000000000000'
      AND "to"   <> '0x0000000000000000000000000000000000000000'
),
pairs AS (
    SELECT collection,
           least(f, t)    AS a,
           greatest(f, t) AS b,
           count(*)                                          AS n,
           count(*) FILTER (WHERE f = least(f, t))           AS ab,
           count(*) FILTER (WHERE f = greatest(f, t))        AS ba
    FROM tx
    GROUP BY collection, least(f, t), greatest(f, t)
),
pair_agg AS (
    SELECT collection,
           sum(n)                                                     AS total_transfers,
           sum(CASE WHEN ab > 0 AND ba > 0 THEN n ELSE 0 END)         AS reciprocal_transfers,
           count(*)                                                   AS distinct_pairs,
           count(*) FILTER (WHERE ab > 0 AND ba > 0)                  AS reciprocal_pairs
    FROM pairs
    GROUP BY collection
),
traders AS (
    SELECT collection, count(DISTINCT addr) AS distinct_traders, count(*) AS legs
    FROM (
        SELECT collection, f AS addr FROM tx
        UNION ALL
        SELECT collection, t AS addr FROM tx
    ) u
    GROUP BY collection
)
SELECT p.collection,
       p.total_transfers,
       p.reciprocal_transfers,
       p.reciprocal_pairs,
       tr.distinct_traders,
       -- reciprocity in [0,1]: share of transfers inside a back-and-forth pair
       CASE WHEN p.total_transfers = 0 THEN 0
            ELSE round(p.reciprocal_transfers::numeric / p.total_transfers, 4) END AS reciprocity,
       -- concentration in [0,1]: 1 when a handful of wallets drive everything
       CASE WHEN p.total_transfers = 0 THEN 0
            ELSE greatest(0, round(1 - (tr.distinct_traders::numeric /
                 nullif(p.total_transfers, 0)), 4)) END AS concentration,
       -- composite penalty, clamped to [0,1]
       least(1.0, greatest(0.0,
            0.6 * (CASE WHEN p.total_transfers = 0 THEN 0
                        ELSE p.reciprocal_transfers::numeric / p.total_transfers END)
          + 0.4 * (CASE WHEN p.total_transfers = 0 THEN 0
                        ELSE greatest(0, 1 - tr.distinct_traders::numeric /
                             nullif(p.total_transfers, 0)) END)
       ))::numeric(6,4) AS wash_penalty
FROM pair_agg p
JOIN traders tr USING (collection);

-- ---------------------------------------------------------------------------
-- 2. Time-decayed, wash-discounted market metrics per collection.
--    Volume/buyers come from *settled sales* (TBAGuard), which cost real ETH to
--    a counterparty and carry a verified price — a far better signal than raw
--    ERC-721 transfers. Each sale is weighted by exp(-age / HALFLIFE) so recent
--    activity dominates without a hard time-window cliff.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_collection_metrics AS
WITH params AS (
    SELECT 43200.0::numeric AS halflife_seconds,          -- 12h decay
           extract(epoch FROM now())::numeric AS now_s
),
decayed AS (
    SELECT s.collection,
           sum((s.price_wei::numeric / 1e18)
               * exp(-greatest(0, (p.now_s - s."timestamp"::numeric)) / p.halflife_seconds)
           )                                               AS decayed_volume_eth,
           -- unique buyers, decay-weighted by their most recent purchase
           count(DISTINCT s.buyer)                          AS unique_buyers,
           count(*)                                         AS sales_count,
           sum(s.price_wei::numeric / 1e18)                 AS raw_volume_eth
    FROM sale s CROSS JOIN params p
    WHERE s.collection IS NOT NULL
    GROUP BY s.collection
),
floors AS (
    -- Floor = lowest active listing price per collection.
    SELECT collection, min(price_wei::numeric / 1e18) AS floor_eth
    FROM listing
    WHERE active
    GROUP BY collection
),
mints AS (
    -- PRIMARY volume: each mint's actual ETH paid (post-refund, so Dutch-auction
    -- price dynamics are captured exactly), decayed the same way as sales. A live
    -- drop or auction shows up here even before any secondary trade exists.
    SELECT m.collection,
           sum((m.paid_wei::numeric / 1e18)
               * exp(-greatest(0, (p.now_s - m."timestamp"::numeric)) / p.halflife_seconds)
           )                                            AS decayed_mint_volume_eth,
           sum(m.paid_wei::numeric / 1e18)              AS raw_mint_volume_eth,
           count(*)                                     AS mint_txns
    FROM mint_event m CROSS JOIN params p
    GROUP BY m.collection
)
SELECT c.address AS collection,
       c.name, c.symbol, c.creator,
       c.holder_count, c.unique_minters, c.total_minted,
       c.coin_address, c.pair_address,
       f.floor_eth::numeric(30,6)                            AS floor_eth,
       coalesce(d.decayed_volume_eth, 0)::numeric(30,6)      AS decayed_volume_eth,
       coalesce(d.raw_volume_eth, 0)::numeric(30,6)          AS raw_volume_eth,
       coalesce(d.unique_buyers, 0)                          AS unique_buyers,
       coalesce(d.sales_count, 0)                            AS sales_count,
       coalesce(mv.decayed_mint_volume_eth, 0)::numeric(30,6) AS decayed_mint_volume_eth,
       coalesce(mv.raw_mint_volume_eth, 0)::numeric(30,6)    AS raw_mint_volume_eth,
       coalesce(mv.mint_txns, 0)                             AS mint_txns,
       coalesce(w.wash_penalty, 0)                           AS wash_penalty,
       coalesce(w.reciprocity, 0)                            AS reciprocity,
       coalesce(w.concentration, 0)                          AS concentration
FROM collection c
LEFT JOIN decayed d           ON d.collection = c.address
LEFT JOIN floors f            ON f.collection = c.address
LEFT JOIN mints mv            ON mv.collection = c.address
LEFT JOIN vw_wash_signals w   ON w.collection = c.address;

-- ---------------------------------------------------------------------------
-- 3. Final trending score.
--    score = ( 0.30*ln(1+unique_buyers)        -- secondary demand
--            + 0.18*ln(1+holder_count)         -- distribution
--            + 0.14*ln(1+unique_minters)       -- primary participation (breadth)
--            + 0.22*ln(1+decayed_mint_volume)  -- PRIMARY volume (drops / Dutch auctions)
--            + 0.16*ln(1+decayed_volume) )     -- secondary settled volume
--            * (1 - wash_penalty)
--    Logs damp whales; the wash multiplier collapses collections that are just a
--    few wallets passing a token around. Primary mint volume captures a live drop
--    or auction immediately — but it is co-weighted with unique_minters so a single
--    whale self-minting to inflate volume is tempered by the lack of breadth. (A
--    dedicated primary-side sybil signal is a documented follow-up.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_trending AS
SELECT m.*,
       round(
           ( 0.30 * ln(1 + m.unique_buyers)
           + 0.18 * ln(1 + m.holder_count)
           + 0.14 * ln(1 + m.unique_minters)
           + 0.22 * ln(1 + m.decayed_mint_volume_eth)
           + 0.16 * ln(1 + m.decayed_volume_eth)
           ) * (1 - m.wash_penalty)
       , 6) AS trending_score
FROM vw_collection_metrics m
ORDER BY trending_score DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- 4. Creator earnings rollup (from the FeeSplitter ledger).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_creator_earnings AS
SELECT account,
       sum(amount_wei::numeric) FILTER (WHERE kind = 'mint_creator')::numeric(40,0) AS mint_earnings_wei,
       sum(amount_wei::numeric) FILTER (WHERE kind = 'claim')::numeric(40,0)        AS claimed_wei,
       count(*) FILTER (WHERE kind = 'mint_creator')                                AS mint_events
FROM fee_event
GROUP BY account;
