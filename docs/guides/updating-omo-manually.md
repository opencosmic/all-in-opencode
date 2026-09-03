# Cập nhật OMO thủ công

```text
OMO mới
↓
không cài production ngay
↓
tạo candidate
↓
kiểm tra P01/P02/P03
↓
chạy compatibility gate
↓
PASS → promote
FAIL → giữ OMO hiện tại
```

Không cập nhật trực tiếp package OMO production trước khi candidate vượt qua
toàn bộ gate. Nguồn chuẩn là
[`omo-runtime-baseline.json`](../reference/omo-runtime-baseline.json).

## Chuẩn bị candidate

```sh
git clone https://github.com/code-yeongyu/oh-my-openagent.git ~/src/omo-candidate
cd ~/src/omo-candidate
git fetch --tags origin
git checkout -b integration/omo-<version> <upstream-tag-or-commit>
bun install --frozen-lockfile
bun run build
```

Chạy static gate từ repository workflow:

```sh
cd ~/Workspace/repo/opencode-workflow
./scripts/check-omo-update.sh --candidate ~/src/omo-candidate
```

`STATIC_RESULT: PASS` không phải là quyền promote. Sau đó chạy toàn bộ lệnh
trong `requiredChecks.omo` và `requiredChecks.runtime` của baseline. Runtime
probe phải pin model được phép, reasoning `high` hoặc thấp hơn, và tắt mọi
fallback không được phép.

## A. Không cần local patch

Khi P01/P02/P03 đều `UPSTREAMED`, checkout upstream candidate, build, chạy
gate ở trên và runtime probes. Chỉ sau khi tất cả PASS mới cập nhật plugin
production sang đúng artifact đã test.

## B/C. Chỉ một số hoặc không patch nào được upstream

Tạo branch integration mới từ upstream candidate. Chỉ cherry-pick các patch
được baseline ghi là `STILL_REQUIRED`; không áp lại patch `UPSTREAMED` hoặc
`REPLACED_BY_EQUIVALENT`.

```sh
git cherry-pick <P01-commit-if-required>
git cherry-pick <P02-commit-if-required>
git cherry-pick <P03-commit-if-required>
```

Cherry-pick sạch không chứng minh tương thích: vẫn phải build, static gate,
runtime probes và lane E2E.

## D/F. Conflict hoặc test fail

**DỪNG. Không promote production.** Không đoán cách resolve conflict.

```sh
git cherry-pick --abort
```

Giữ OMO production hiện tại. Candidate thất bại có thể bị xóa sau khi kiểm tra
đúng path của candidate; không dùng `git reset --hard` trên user work.

## E. Upstream thay thế patch bằng hành vi tương đương

Không ép code patch cũ vào kiến trúc mới. Chạy `check-omo-update.sh`, sau đó
chạy CAP-01/CAP-02/CAP-08 runtime probes. Chỉ khi PASS mới đổi trạng thái patch
thành `REPLACED_BY_EQUIVALENT` hoặc `UPSTREAMED` trong baseline.

## G. Beta/prerelease

Test stable trước. Không chuyển production stable sang beta trừ khi beta là
cách duy nhất có capability bắt buộc và tất cả gate đã PASS. Beta.39 đã bị từ
chối trên OpenCode 1.18.25 vì agent-resolution preflight timeout.

## H/I. PR #7534 không merge hoặc merge muộn

Nếu PR không merge, integration branch mới vẫn có thể dùng upstream + P01
(và P02/P03 nếu cần). Nếu PR merge, không tự bỏ P01: xác nhận hành vi bằng
CAP-01/CAP-02/CAP-08 probes trước, rồi mới retire patch.

## Promote và rollback

Promotion là bước thủ công riêng: pin đúng commit/artifact đã PASS, lưu lại
plugin spec cũ và cập nhật baseline trong cùng review. Nếu smoke test lỗi,
khôi phục chính xác plugin spec cũ rồi xác nhận `opencode --version` và plugin
path. Không sửa `~/.cache/opencode/...`: cache không phải source có thể review,
không ổn định và không có rollback đáng tin cậy.
