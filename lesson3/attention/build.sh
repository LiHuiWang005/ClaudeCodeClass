#!/usr/bin/env bash
# build.sh — 注意力 · 幕后页文档源内联脚本
# ============================================================
# 用途: 把 spec.md 和 task.md 内联到 index.html 的
#       <script type="text/markdown" id="spec-source"> /
#       <script type="text/markdown" id="task-source"> 标签里。
#
# 这是开发期辅助脚本（纯 bash + sed，零依赖）。
# 运行时 index.html 仍然是单文件零依赖——只是把磁盘上
# spec.md / task.md 的当前内容拷贝到 HTML 内联节点。
#
# 用法:
#   bash build.sh           # 在项目目录运行
#
# 触发时机:
#   - spec.md 或 task.md 改动后
#   - 准备发布前
# ============================================================
set -euo pipefail

cd "$(dirname "$0")"

SPEC="spec.md"
TASK="task.md"
HTML="index.html"

[ -f "$SPEC" ] || { echo "ERROR: $SPEC not found"; exit 1; }
[ -f "$TASK" ] || { echo "ERROR: $TASK not found"; exit 1; }
[ -f "$HTML" ] || { echo "ERROR: $HTML not found"; exit 1; }

TMP=$(mktemp /tmp/attention-build-XXXXXX.html)

# 用 awk 替换 BUILD:SPEC 和 BUILD:TASK 标记之间的内容
awk -v spec="$SPEC" -v task="$TASK" '
  BEGIN {
    while ((getline line < spec) > 0) spec_content = spec_content line "\n"
    close(spec)
    while ((getline line < task) > 0) task_content = task_content line "\n"
    close(task)
  }
  /<!-- BUILD:SPEC -->/ {
    print
    print spec_content
    in_spec = 1
    next
  }
  /<!-- BUILD:\/SPEC -->/ {
    in_spec = 0
    print
    next
  }
  /<!-- BUILD:TASK -->/ {
    print
    print task_content
    in_task = 1
    next
  }
  /<!-- BUILD:\/TASK -->/ {
    in_task = 0
    print
    next
  }
  in_spec || in_task { next }
  { print }
' "$HTML" > "$TMP"

mv "$TMP" "$HTML"

# 报告体积
size_html=$(wc -c < "$HTML" | tr -d ' ')
size_kb=$(awk -v b="$size_html" 'BEGIN{printf "%.1f", b/1024}')

echo "✓ 内联完成"
echo "  spec.md ($(wc -l < "$SPEC" | tr -d ' ') 行) → #spec-source"
echo "  task.md ($(wc -l < "$TASK" | tr -d ' ') 行) → #task-source"
echo "  index.html: ${size_kb} KB"

# 200KB 预算检查
if [ "$size_html" -gt 204800 ]; then
  echo "⚠ 警告：单文件超过 200KB 预算"
fi
