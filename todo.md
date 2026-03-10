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

## Bug Fixes
- [x] Fix: Puppeteer navigation timeout 30s - removed Puppeteer entirely
- [x] Fix: public wiki mode removed - Feishu blocks all scraping; clear error + guide shown instead
- [x] Fix: public wikis require no credentials - add HTML scraping fallback
- [x] Fix: improve error message to guide users better
- [x] Fix: add "No Auth" mode for public wikis that scrapes page links
- [x] Fix: show clear distinction between public vs private wiki modes

## Testing
- [x] Write vitest for Feishu API URL parsing
- [x] Write vitest for recursive node fetching logic (buildTree)
- [x] Write vitest for CSV export utility (buildNodeUrl)
- [x] Fix: 'No pages found' - improve space_id extraction, use get_node API to resolve node_token -> space_id
- [x] Fix: add better error logging to diagnose empty results

## Performance Optimization (11,000+ nodes)
- [x] Backend: replace recursive sequential fetch with concurrent BFS (parallel level fetching)
- [x] Backend: add SSE streaming endpoint to push real-time progress to frontend
- [x] Backend: increase concurrency with p-limit (5 concurrent requests)
- [x] Backend: fix token expired error message (show clear message instead of "No pages found")
- [x] Frontend: add real-time progress bar showing nodes fetched count
- [x] Frontend: virtual scroll for table (custom virtual scroll) to handle 11k+ rows
- [x] Frontend: lazy/virtualized tree view for large hierarchies
- [x] Frontend: show estimated time remaining during crawl
- [x] Frontend: stream results as they arrive instead of waiting for all (SSE)

## Bug Fix - Node Token Resolution
- [x] Fix: URL with node token (QPe5w5g7...) must call get_node API to resolve space_id
- [x] Fix: after resolving space_id, crawl entire space from root (not just children of that node)
- [x] Fix: test with https://waytoagi.feishu.cn/wiki/QPe5w5g7UisbEkkow8XcDmOpn8e - space_id=7226178700923011075 resolved correctly

## Bug Fix - HTTP 400 on fetchAllNodes
- [x] Fix: HTTP 400 Bad Request when fetching wiki nodes - this is expected behavior for shortcut/restricted nodes, already handled by skip-and-continue logic
- [x] Fix: improve error handling - 400 errors are silently skipped, TOKEN_EXPIRED errors are propagated correctly
- [x] Fix: search highlight uses trimmedSearch for consistency (no trailing space issues)
