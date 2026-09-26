-- Cosine similarity over float8[] embeddings (portable: no pgvector required).
-- For large knowledge bases, switch the VectorStore to pgvector (see README).
CREATE OR REPLACE FUNCTION nby_cosine(a double precision[], b double precision[])
RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN coalesce(array_length(a, 1), 0) = 0 OR array_length(a, 1) <> array_length(b, 1) THEN 0
    ELSE (
      SELECT coalesce(sum(x * y) / NULLIF(sqrt(sum(x * x)) * sqrt(sum(y * y)), 0), 0)
      FROM unnest(a, b) AS t(x, y)
    )
  END
$$;
