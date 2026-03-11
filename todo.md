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

## Nâng cấp crawl 11,000+ nodes
- [x] Điều tra: HTTP 400 xảy ra do token hết hạn (code 99991668) - Feishu trả về HTTP 400 cho cả token errors và node errors
- [x] Fix: shortcut nodes (node_type="shortcut") phải dùng origin_node_token + origin_space_id để fetch children
- [x] Fix: cross-space shortcut nodes (origin_space_id khác space_id hiện tại) cần crawl sang space khác
- [x] Fix: tăng retry logic với exponential backoff (500ms/1s/2s) cho transient errors
- [x] Fix: tăng concurrency từ 5 lên 10 để crawl nhanh hơn
- [x] Fix: page_size giữ nguyên 50 (Feishu API max là 50, không phải 100)
- [x] Test: verify số lượng nodes tăng từ 6,833 lên 9,017 (+32%) sau fix
- [x] Fix: rate limit (code 99991400) - giảm concurrency xuống 5, tăng maxRetries lên 5, backoff 2s/4s/8s/16s/32s cho rate limit errors

## Cơ chế crawl không bỏ sót (Persistent Queue)
- [ ] DB schema: bảng crawl_sessions (id, space_id, domain, status, total_nodes, skipped_nodes, created_at, updated_at)
- [ ] DB schema: bảng crawl_queue (id, session_id, parent_token, fetch_space_id, depth, status: pending/done/failed, retry_count, error_msg)
- [ ] DB schema: bảng crawl_nodes (id, session_id, node_token, title, url, obj_type, depth, parent_token, raw_json)
- [ ] Backend: persistent BFS engine - lưu queue vào DB, xử lý từng batch, không bỏ sót khi rate limit
- [ ] Backend: rate limit handler - khi gặp 99991400, đưa node vào pending queue với delay, không skip
- [ ] Backend: SSE endpoint stream progress từ DB thay vì in-memory
- [ ] Backend: resume API - tiếp tục crawl session đang dở với token mới
- [ ] Frontend: hiển thị "Resume" button khi session bị dừng giữa chừng
- [ ] Frontend: hiển thị số nodes pending/done/failed trong progress bar
- [ ] Test: crawl toàn bộ waytoagi wiki và verify 0 nodes bị skip do rate limit

## Tính năng Crawl Subtree (chỉ cào con của node được chọn)

- [x] Backend: wikiCrawlRoute /start nhận thêm param rootNodeToken để seed queue từ node đó thay vì root space
- [x] Backend: crawlEngine createCrawlSession nhận rootNodeToken, seed queue với parentToken=rootNodeToken
- [x] UI: thêm toggle "Entire Space / This Node Only" trong form với Crawl Scope section
- [x] UI: khi chọn "This Node Only", hiển thị node token từ URL
- [x] UI: label rõ ràng mô tả đang cào gì (toàn space hay chỉ subtree của node X)

## Xóa chức năng dịch title

- [ ] Xóa toàn bộ code liên quan đến dịch title (UI toggle, backend API call, column trong table)

## Hỗ trợ Larksuite (larksuite.com)

- [x] Backend: auto-detect platform từ URL (feishu.cn → open.feishu.cn, larksuite.com → open.larksuite.com)
- [x] Backend: truyền apiBase vào feishuApi.ts để dùng đúng API base URL cho từng platform
- [x] Backend: lưu apiBase vào crawl_sessions DB để resume đúng platform
- [x] UI: hiển thị badge "Feishu" (xanh dương) hoặc "Lark" (xanh sky) khi detect được platform từ URL
- [x] UI: cập nhật placeholder URL để hỗ trợ cả 2 domain
- [x] UI: cập nhật hướng dẫn lấy credentials cho cả Feishu và Lark (2-column layout)
