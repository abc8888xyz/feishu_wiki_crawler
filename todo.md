# Feishu Wiki Crawler - TODO

## Backend
- [x] Add wiki_crawl_sessions table to schema
- [x] Add wiki_nodes table to schema
- [x] Run db:push to migrate schema (not needed, no persistent storage for crawl results)
- [x] Create Feishu API helper (feishuApi.ts) to call Feishu Wiki API
- [x] Create tRPC router for wiki crawling (extract space_id, fetch nodes recursively)
- [x] Support Feishu user_access_token for private wikis
- [x] Handle pagination (page_token) for large wiki spaces
- [x] Support both public and private wiki spaces

## Frontend
- [x] Design clean light-themed UI with clean card layout
- [x] URL input form with space_id auto-extraction
- [x] Feishu OAuth login option (App ID + App Secret input + User Access Token)
- [x] Tree view component showing hierarchical wiki structure
- [x] Searchable and sortable table view with columns: title, URL, type, depth, created_at, updated_at
- [x] CSV export functionality
- [x] Loading states and progress indicator during crawl
- [x] Error handling and user-friendly error messages
- [x] Pagination support for large result sets (50 rows per page in table)

## Testing
- [x] Write vitest for Feishu API URL parsing
- [x] Write vitest for recursive node fetching logic (buildTree)
- [x] Write vitest for CSV export utility (buildNodeUrl)
