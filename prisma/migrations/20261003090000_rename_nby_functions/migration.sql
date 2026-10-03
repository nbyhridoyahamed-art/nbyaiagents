-- Rebrand: rename helper functions. Column defaults reference the functions by OID,
-- so they follow the rename automatically.
ALTER FUNCTION nby_id(text) RENAME TO vdo_id;
ALTER FUNCTION nby_cosine(double precision[], double precision[]) RENAME TO vdo_cosine;
