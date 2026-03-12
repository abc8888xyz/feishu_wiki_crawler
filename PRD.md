# Product Requirements Document
## Feishu Wiki Crawler — v2.1

**Tác giả:** Manus AI
**Ngày cập nhật:** Tháng 3, 2026
**Phiên bản:** 2.1 (Stable)
**Trạng thái:** Production-ready

---

## 1. Tổng Quan Sản Phẩm

**Feishu Wiki Crawler** là một ứng dụng web chuyên dụng giúp người dùng thu thập, trực quan hóa và xuất toàn bộ cấu trúc nội dung từ không gian wiki Feishu (飞书) và Lark (larksuite.com). Ứng dụng giải quyết bài toán thực tế: khi một tổ chức có hàng nghìn trang tài liệu trên Feishu Wiki, việc kiểm kê, sao lưu hoặc di chuyển nội dung đòi hỏi phải thu thập toàn bộ danh sách trang — điều mà giao diện Feishu không hỗ trợ trực tiếp.

### 1.1 Vấn Đề Cần Giải Quyết

Feishu Wiki cung cấp giao diện duyệt tài liệu nhưng không có tính năng xuất danh sách trang, sao lưu hàng loạt, hay tạo sitemap. Người dùng muốn biết wiki của mình có bao nhiêu trang và cấu trúc phân cấp như thế nào; xuất toàn bộ nội dung dạng Markdown để lưu trữ offline hoặc chuyển sang hệ thống khác (Notion, Obsidian, Confluence); kiểm kê tài liệu theo loại (docx, sheet, bitable, mindnote...) để lên kế hoạch migration; và lưu lịch sử các lần crawl để so sánh và quản lý theo thời gian.

### 1.2 Đối Tượng Người Dùng

| Nhóm | Mô tả | Nhu cầu chính |
|------|-------|---------------|
| **Quản trị viên IT** | Quản lý hệ thống tài liệu nội bộ doanh nghiệp | Kiểm kê, backup, migration |
| **Kỹ sư nội dung** | Xây dựng knowledge base, tài liệu kỹ thuật | Export Markdown để tích hợp vào CI/CD docs |
| **Quản lý dự án** | Theo dõi tài liệu dự án trên Feishu | Tạo danh sách trang, kiểm tra cấu trúc |
| **Nhà phát triển** | Tích hợp Feishu vào workflow tự động | Lấy dữ liệu dạng JSON/CSV để xử lý tiếp |

---

## 2. Phạm Vi Tính Năng

### 2.1 In Scope — Đã Triển Khai

**Crawl và Thu Thập Dữ Liệu**

Ứng dụng hỗ trợ thu thập toàn bộ cây wiki từ root của một Space (Entire Space mode) hoặc chỉ cây con của một node cụ thể (Subtree mode). Cả hai nền tảng Feishu (`feishu.cn`) và Lark (`larksuite.com`) đều được hỗ trợ với auto-detection từ URL. Shortcut nodes (cross-space links) được xử lý bằng cách theo dõi `origin_node_token`. Persistent BFS queue lưu vào database đảm bảo không bỏ sót node khi bị rate limit hoặc token hết hạn. Người dùng có thể resume crawl từ điểm dừng khi cung cấp token mới. Tiến trình được cập nhật real-time qua polling mỗi 2 giây.

**Xác Thực**

Hỗ trợ hai chế độ: App Credentials (App ID + App Secret) để lấy `tenant_access_token` tự động, và User Access Token (nhập trực tiếp, hữu hiệu 2 giờ). Tính năng Test Connection giúp xác minh credentials trước khi crawl. Platform được auto-detect từ URL để dùng đúng API endpoint.

**Hiển Thị Kết Quả**

Tree View hiển thị cấu trúc phân cấp tương tác với tìm kiếm và highlight (tự động tắt khi > 5.000 nodes). Table View sử dụng virtual scroll hỗ trợ 10.000+ rows, có tìm kiếm full-text, lọc theo loại node, sắp xếp theo cột. Thống kê loại node (docx, sheet, bitable, mindnote, slides...) hiển thị dạng badge. Badge platform (Feishu / Lark) và domain được hiển thị rõ ràng.

**Export Dữ Liệu**

- **CSV**: Xuất toàn bộ metadata (title, URL, type, depth, created_at, updated_at).
- **JSON**: Xuất toàn bộ node objects dạng JSON array.
- **Markdown ZIP**: Xuất nội dung của tất cả trang `docx` thành file `.md`, tổ chức theo thư mục phân cấp phản ánh cấu trúc wiki. Yêu cầu User Access Token.

**Tab Lịch Sử**

Danh sách tất cả phiên crawl với trạng thái (Running / Paused / Done / Failed). Cho phép xem lại kết quả của phiên cũ, xóa phiên (cascade delete), tìm kiếm theo domain, và thống kê tổng hợp.

### 2.2 Out of Scope — Không Triển Khai

**Export Docx/PDF** đã được nghiên cứu và loại bỏ: Feishu Drive Export API yêu cầu scope `drive:export` đặc biệt không khả dụng với cấu hình app thông thường (lỗi `1069902: no permission`).

Ngoài ra, ứng dụng không hỗ trợ: crawl nội dung trang không phải docx (Sheet, Bitable, Mindnote, Slides chỉ được liệt kê metadata); đồng bộ hai chiều (chỉ đọc, không ghi lại Feishu); lên lịch crawl tự động (không có cron job); và xác thực người dùng ứng dụng (không yêu cầu đăng nhập vào ứng dụng này).

---

## 3. Kiến Trúc Kỹ Thuật

### 3.1 Technology Stack

| Tầng | Công nghệ | Phiên bản |
|------|-----------|-----------|
| **Frontend** | React + TypeScript | 19 / 5.x |
| **Styling** | Tailwind CSS + shadcn/ui | 4.x |
| **API Layer** | tRPC + Express | 11 / 4.x |
| **Database** | MySQL / TiDB (via Drizzle ORM) | — |
| **Build** | Vite | 6.x |
| **Testing** | Vitest | 2.x |
| **Packaging** | archiver (ZIP) | — |

### 3.2 Mô Hình Dữ Liệu

Hệ thống sử dụng ba bảng chính trong MySQL/TiDB:

**Bảng `crawl_sessions`** — Mỗi lần crawl tạo một session:

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | INT PK | Auto-increment |
| `spaceId` | VARCHAR(64) | Feishu Space ID |
| `domain` | VARCHAR(256) | Domain của wiki (ví dụ: `waytoagi.feishu.cn`) |
| `apiBase` | VARCHAR(256) | API endpoint (`open.feishu.cn` hoặc `open.larksuite.com`) |
| `status` | ENUM | `running` / `paused` / `done` / `failed` |
| `totalNodes` | INT | Số nodes đã crawl được |
| `pendingQueue` | INT | Số tasks còn trong queue |
| `skippedNodes` | INT | Số nodes bị bỏ qua (lỗi vĩnh viễn) |
| `errorMsg` | TEXT | Thông báo lỗi nếu failed |
| `createdAt` | TIMESTAMP | Thời điểm bắt đầu crawl |

**Bảng `crawl_queue`** — Persistent BFS queue:

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | INT PK | Auto-increment |
| `sessionId` | INT FK | Liên kết với `crawl_sessions` |
| `parentToken` | VARCHAR(64) | Token của node cha (null = root) |
| `fetchSpaceId` | VARCHAR(64) | Space ID cần fetch (hỗ trợ cross-space shortcuts) |
| `depth` | INT | Độ sâu trong cây |
| `status` | ENUM | `pending` / `done` / `failed` |
| `retryCount` | INT | Số lần retry đã thực hiện |

**Bảng `crawl_nodes`** — Tất cả nodes đã thu thập:

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | INT PK | Auto-increment |
| `sessionId` | INT FK | Liên kết với `crawl_sessions` |
| `nodeToken` | VARCHAR(64) | Token định danh node trong Feishu |
| `objToken` | VARCHAR(64) | Token của document object (dùng để export) |
| `objType` | VARCHAR(32) | Loại document: `docx`, `sheet`, `bitable`... |
| `nodeType` | VARCHAR(32) | Loại node: `origin` hoặc `shortcut` |
| `originNodeToken` | VARCHAR(64) | Token gốc (cho shortcut nodes) |
| `originSpaceId` | VARCHAR(64) | Space gốc (cho cross-space shortcuts) |
| `parentNodeToken` | VARCHAR(64) | Token của node cha |
| `title` | TEXT | Tiêu đề trang |
| `url` | TEXT | URL đầy đủ của trang |
| `depth` | INT | Độ sâu trong cây (0 = root) |
| `hasChild` | INT | 0/1 — có node con hay không |
| `objCreateTime` | BIGINT | Unix timestamp tạo document |
| `objEditTime` | BIGINT | Unix timestamp chỉnh sửa gần nhất |

### 3.3 Luồng Crawl — Persistent BFS

Luồng crawl sử dụng kiến trúc **background job + polling** thay vì SSE để tránh timeout trên wiki lớn:

```
Client                    Server                      Feishu API
  │                          │                              │
  ├─ POST /crawl/start ──────►│                              │
  │                          ├─ createCrawlSession()         │
  │                          │  (seed queue với root)        │
  │◄─ { sessionId } ─────────┤                              │
  │                          │                              │
  ├─ GET /crawl/status ──────►│ (poll mỗi 2s)               │
  │                          ├─ runCrawlSession()            │
  │                          │  ├─ fetch batch từ queue      │
  │                          │  ├─ gọi Feishu list_nodes ───►│
  │                          │  ├─ lưu nodes vào DB          │
  │                          │  ├─ thêm children vào queue   │
  │                          │  └─ xử lý rate limit (retry)  │
  │◄─ { status, count } ─────┤                              │
  │                          │                              │
  ├─ GET /crawl/nodes ───────►│ (khi status=done)            │
  │◄─ { nodes[], tree[] } ───┤                              │
```

**Xử lý rate limit:** Khi nhận lỗi `99991400` từ Feishu, engine tự động retry với exponential backoff (2s → 4s → 8s → 16s → 32s, tối đa 5 lần). Khi token hết hạn (`99991668`), session chuyển sang `paused` và người dùng có thể resume với token mới.

**Xử lý shortcut nodes:** Nodes loại `shortcut` có `originNodeToken` và `originSpaceId` khác với space hiện tại. Engine tự động theo dõi và crawl sang space gốc để lấy children.

| Loại lỗi | Mã lỗi Feishu | Xử lý |
|----------|---------------|-------|
| Token hết hạn | 99991668 | Pause session, thông báo user, cho phép Resume |
| Rate limit | 99991400 | Backoff 2s→32s, retry tối đa 5 lần |
| Không có quyền | 230002-230004 | Bỏ qua node, tăng `skippedNodes`, tiếp tục |
| Lỗi HTTP 5xx | — | Retry với backoff 500ms→8s |

### 3.4 Luồng Export Markdown

```
Client                    Server                      Feishu Docs API
  │                          │                              │
  ├─ POST /export/start ─────►│                              │
  │  { sessionId, token }     ├─ load docx nodes từ DB       │
  │                          ├─ tạo ExportJob (in-memory)    │
  │◄─ { jobId } ─────────────┤                              │
  │                          │                              │
  ├─ GET /export/status ─────►│ (poll mỗi 2s)               │
  │                          ├─ buildNodePaths()             │
  │                          │  (xây dựng cây thư mục)       │
  │                          ├─ fetchDocxMarkdown() ────────►│
  │                          │  (concurrency=3, delay=800ms) │
  │                          ├─ đóng gói vào ZIP buffer      │
  │◄─ { done, total } ───────┤                              │
  │                          │                              │
  ├─ GET /export/download ───►│                              │
  │◄─ ZIP file ──────────────┤                              │
```

**Tổ chức thư mục trong ZIP:** Hàm `buildNodePaths()` xây dựng đường dẫn đầy đủ cho từng node dựa trên cây cha-con. Ví dụ cấu trúc ZIP đầu ra:

```
Chương_1/
  Giới_thiệu.md
  Phần_1.1/
    Chi_tiết.md
    Bài_thực_hành.md
Chương_2/
  Tổng_quan.md
  Phần_2.1/
    Hướng_dẫn.md
```

---

## 4. API Endpoints

### 4.1 REST Endpoints (Express)

| Method | Path | Mô tả |
|--------|------|-------|
| `POST` | `/api/wiki/crawl/start` | Bắt đầu phiên crawl mới (persistent BFS) |
| `POST` | `/api/wiki/crawl/resume` | Resume phiên crawl bị tạm dừng |
| `GET` | `/api/wiki/crawl/status` | Lấy trạng thái phiên crawl (poll mỗi 2s) |
| `GET` | `/api/wiki/crawl/nodes` | Lấy tất cả nodes của phiên crawl |
| `POST` | `/api/wiki/export/start` | Bắt đầu export Markdown ZIP |
| `GET` | `/api/wiki/export/status` | Lấy tiến trình export |
| `GET` | `/api/wiki/export/download` | Download file ZIP |

### 4.2 tRPC Procedures

| Procedure | Loại | Mô tả |
|-----------|------|-------|
| `wiki.parseUrl` | Query | Parse URL, trả về token và platform |
| `wiki.crawl` | Mutation | Crawl đơn giản (legacy, không persistent) |
| `wiki.testAuth` | Mutation | Kiểm tra App credentials |
| `wiki.listSessions` | Query | Danh sách tất cả phiên crawl (lịch sử) |
| `wiki.getSessionNodes` | Query | Lấy nodes của một phiên cụ thể |
| `wiki.deleteSession` | Mutation | Xóa phiên crawl và dữ liệu liên quan |

---

## 5. Tính Năng Chi Tiết

### 5.1 Xác Thực

Ứng dụng hỗ trợ hai chế độ xác thực, phù hợp với các trường hợp sử dụng khác nhau.

**App Credentials Mode** cho phép người dùng nhập App ID và App Secret từ Feishu Developer Console. Server tự động lấy `tenant_access_token` (hữu hiệu 2 giờ, tự động gia hạn). Chế độ này phù hợp cho crawl metadata nhưng **không thể** export nội dung Markdown vì thiếu scope `docs:document.content:read`.

**User Access Token Mode** cho phép người dùng nhập token lấy từ [Feishu API Explorer](https://open.feishu.cn/api-explorer). Token này có đầy đủ quyền của người dùng, bao gồm đọc nội dung tài liệu. Nhược điểm là token chỉ hữu hiệu 2 giờ và phải gia hạn thủ công.

> **Lưu ý:** Export Markdown bắt buộc dùng User Access Token. Khi người dùng chọn App Credentials mode, nút MD (ZIP) sẽ bị disable kèm cảnh báo giải thích lý do.

### 5.2 Crawl Engine

**Persistent BFS Queue** là cơ chế cốt lõi đảm bảo không bỏ sót node. Mỗi phiên crawl tạo một session trong DB và seed queue với task đầu tiên (fetch children của root). Engine xử lý từng batch 5 tasks song song, lưu kết quả vào `crawl_nodes`, và thêm children mới vào `crawl_queue`. Khi gặp rate limit, engine retry với backoff thay vì bỏ qua. Khi token hết hạn, session chuyển sang `paused` và người dùng có thể resume.

**Crawl Scope** cho phép người dùng chọn:
- **Entire Space**: Crawl từ root của toàn bộ Space, thu thập tất cả trang.
- **This Node Only**: Crawl chỉ cây con của node được chỉ định trong URL. Hữu ích khi chỉ cần một phần của wiki lớn.

### 5.3 Hiển Thị Kết Quả

**Tree View** hiển thị cấu trúc phân cấp tương tác với khả năng mở/đóng từng nhánh, tìm kiếm với highlight kết quả. Tự động bị tắt khi wiki có hơn 5.000 nodes để tránh ảnh hưởng hiệu năng.

**Table View** sử dụng virtual scroll để xử lý 10.000+ rows mà không ảnh hưởng hiệu năng trình duyệt. Hỗ trợ tìm kiếm full-text, lọc theo loại node, sắp xếp theo các cột (title, type, depth, created_at, updated_at). Mỗi row có link trực tiếp đến trang Feishu.

### 5.4 Export Markdown ZIP

Tính năng export Markdown chuyển đổi nội dung của tất cả trang `docx` trong một phiên crawl thành file `.md` và đóng gói thành ZIP. Quy trình:

1. Lọc các nodes có `objType = "docx"` từ DB.
2. Gọi Feishu Docs API (`/open-apis/docs/v1/content`) cho từng trang với `content_type=markdown`.
3. Thêm YAML frontmatter (title, url, depth, node_token) vào đầu mỗi file.
4. Tổ chức file theo cấu trúc thư mục phản ánh cây wiki (hàm `buildNodePaths`).
5. Đóng gói tất cả vào ZIP buffer in-memory bằng thư viện `archiver`.
6. Cung cấp link download khi hoàn thành.

**Giới hạn:** Chỉ hỗ trợ trang loại `docx`. Sheet, Bitable, Mindnote không có API export Markdown. Tốc độ: 3 trang song song, delay 800ms giữa các batch để tránh rate limit (5 req/s).

### 5.5 Tab Lịch Sử

Tab Lịch Sử cung cấp giao diện quản lý tất cả phiên crawl đã thực hiện:

- **Danh sách sessions** với thông tin: domain, platform, trạng thái (badge màu), số nodes, thời gian crawl.
- **Expand row** để xem chi tiết: spaceId, thống kê nodes/queue/skipped, thông báo lỗi.
- **Xem lại**: Tải nodes của session cũ vào giao diện kết quả hiện tại (chuyển sang tab Crawl).
- **Export MD**: Export Markdown từ session cũ mà không cần crawl lại.
- **Xóa**: Xóa session với confirm dialog (cascade delete nodes và queue).
- **Tìm kiếm**: Lọc sessions theo domain.
- **Thống kê tổng hợp**: Tổng số sessions, tổng nodes, nodes trung bình mỗi session.

---

## 6. Yêu Cầu Phi Chức Năng

### 6.1 Hiệu Năng

| Chỉ số | Mục tiêu | Ghi chú |
|--------|----------|---------|
| Crawl 1.000 nodes | < 2 phút | Concurrency=5, retry included |
| Crawl 10.000 nodes | < 20 phút | Có thể cần resume 1-2 lần nếu token hết hạn |
| Table render 10.000 rows | < 100ms | Virtual scroll |
| Tree render 5.000 nodes | < 2s | Tắt tự động khi > 5.000 |
| Export 500 MD files | < 10 phút | Concurrency=3, delay=800ms |

### 6.2 Độ Tin Cậy

Persistent BFS queue đảm bảo không mất dữ liệu khi server restart giữa chừng (queue còn trong DB), token hết hạn (session chuyển sang `paused`, resume được), rate limit tạm thời (retry với backoff, không skip), hoặc node bị lỗi vĩnh viễn (đánh dấu `failed`, tiếp tục crawl các node khác).

### 6.3 Bảo Mật

Credentials (App ID, App Secret, User Access Token) **không được lưu trữ** ở bất kỳ đâu trên server. Chúng chỉ tồn tại trong bộ nhớ trong thời gian xử lý request. Người dùng phải cung cấp lại credentials mỗi khi resume hoặc export.

---

## 7. Hạn Chế Đã Biết

**User Access Token hết hạn sau 2 giờ.** Đây là giới hạn của Feishu API, không thể thay đổi. Người dùng cần lấy token mới từ API Explorer khi token hết hạn. Với wiki lớn (> 10.000 nodes), có thể cần resume 1-2 lần.

**Export Markdown chỉ hỗ trợ trang docx.** Feishu không cung cấp API export Markdown cho Sheet, Bitable, Mindnote, hay Slides. Các loại trang này chỉ được liệt kê metadata.

**Export job lưu in-memory.** File ZIP sau khi tạo được giữ trong RAM của server. Nếu server restart, job bị mất và người dùng phải export lại.

**Giới hạn 20.000 nodes khi xem lại lịch sử.** Query `getSessionNodes` giới hạn 20.000 rows để tránh quá tải bộ nhớ. Wiki có hơn 20.000 nodes cần crawl lại thay vì xem từ lịch sử.

**Export Docx/PDF không khả dụng.** Feishu Drive Export API yêu cầu scope `drive:export` đặc biệt phải được cấp phép riêng trong Feishu Developer Console (lỗi `1069902: no permission`). Tính năng này đã được nghiên cứu và loại bỏ khỏi phạm vi hiện tại.

---

## 8. Roadmap

### 8.1 Ưu Tiên Cao (P0)

Các tính năng này giải quyết pain points trực tiếp của người dùng hiện tại:

- **Đặt tên/ghi chú cho session**: Thêm trường `note` vào `crawl_sessions` để người dùng đặt tên dễ nhớ cho mỗi lần crawl (ví dụ: "Wiki nội bộ Q1 2026").
- **Re-crawl từ lịch sử**: Nút "Crawl lại" trong tab Lịch Sử để khởi động phiên crawl mới với cùng URL, không cần nhập lại.

### 8.2 Ưu Tiên Trung Bình (P1)

- **File `_index.md` trong mỗi thư mục**: Liệt kê các trang con với link, giúp điều hướng khi đọc offline trong Obsidian hoặc VS Code.
- **Prefix số thứ tự trong tên file**: Thêm `01_`, `02_` vào tên thư mục/file để giữ đúng thứ tự khi mở bằng file explorer.
- **So sánh hai sessions**: Chọn 2 phiên crawl cùng một wiki để xem nodes nào được thêm/xóa giữa 2 lần.
- **Lưu file ZIP lên S3**: Thay vì in-memory, lưu file export lên S3 để tránh mất khi server restart và cho phép share link download.

### 8.3 Ưu Tiên Thấp (P2)

- **Scheduled crawl**: Tự động crawl lại theo lịch (hàng ngày/tuần) và lưu vào lịch sử.
- **Webhook notification**: Gửi thông báo khi crawl hoàn thành (email, Feishu message).
- **Filter khi export**: Chọn chỉ export một số trang/thư mục thay vì toàn bộ.
- **Preview cấu trúc ZIP**: Hiển thị cây thư mục sẽ có trong ZIP trước khi download.

---

## 9. Lịch Sử Phiên Bản

| Phiên bản | Tháng | Thay đổi chính |
|-----------|-------|----------------|
| **v1.0** | 02/2026 | MVP: crawl cơ bản, tree view, table view, CSV export |
| **v1.1** | 02/2026 | Thêm User Access Token, xử lý private wikis |
| **v1.2** | 02/2026 | Tối ưu hiệu năng: concurrent BFS, SSE streaming |
| **v1.3** | 02/2026 | Fix shortcut nodes, cross-space crawling |
| **v1.4** | 02/2026 | Persistent BFS queue (DB-backed), resume support |
| **v1.5** | 02/2026 | Subtree crawl mode, Larksuite support |
| **v2.0** | 03/2026 | Export Markdown ZIP với tổ chức thư mục phân cấp |
| **v2.1** | 03/2026 | Tab Lịch Sử: xem lại, xóa, export từ sessions cũ |

---

## 10. Phụ Lục: Feishu API Được Sử Dụng

| API | Endpoint | Mục đích |
|-----|----------|---------|
| Get Tenant Access Token | `POST /open-apis/auth/v3/tenant_access_token/internal` | Lấy app token từ App ID + Secret |
| Get Wiki Node Info | `GET /open-apis/wiki/v2/spaces/get_node` | Resolve node_token → space_id |
| List Wiki Nodes | `GET /open-apis/wiki/v2/spaces/{space_id}/nodes` | Lấy danh sách nodes trong một space |
| Get Doc Content | `GET /open-apis/docs/v1/content` | Lấy nội dung Markdown của một trang docx |

Tất cả API calls đều thông qua `open.feishu.cn` (Feishu) hoặc `open.larksuite.com` (Lark) tùy theo platform được detect từ URL đầu vào.
