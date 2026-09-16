"""The ceilings of SPEC section 3.7, in one place.

"An artifact that cannot be bounded cannot be checked," and the numbers are
part of the published behaviour of charter/0.1: changing one changes what a
verdict means, so it belongs in the spec and in the recorded answers rather
than in a patch. A limit is checked before the work it bounds, not after.
"""

FILE_BYTES = 256 * 1024 * 1024
ENTRY_COMPRESSED_BYTES = 64 * 1024 * 1024
ENTRY_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
PROVENANCE_ENTRIES = 100_000
PROVENANCE_LINE_BYTES = 1024 * 1024
JSON_DOCUMENT_BYTES = 1024 * 1024
JSON_DEPTH = 64
ENTRY_NAME_BYTES = 65_535
EOCD_SEARCH_BYTES = 65_535
