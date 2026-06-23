"""
用户转化漏斗分析 — Claude Code 可执行版本
==========================================
用法：将此文件拖入 Claude Code 对话框，
      或运行：python funnel_analysis.py

生成：转化率表格 + 漏斗图 + 柱状图 + 流失分析图
"""

import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import numpy as np
from pathlib import Path

# ============================================================
# 尝试加载中文字体（macOS / Linux / Windows）
# ============================================================
def get_chinese_font():
    """自动查找系统中的中文字体"""
    candidates = [
        'PingFang SC', 'Heiti SC', 'STHeiti', 'Microsoft YaHei',
        'WenQuanYi Micro Hei', 'Noto Sans CJK SC', 'SimHei'
    ]
    available = [f.name for f in fm.fontManager.ttflist]
    for c in candidates:
        if c in available:
            return fm.FontProperties(family=c)
    # fallback: use sans-serif
    return fm.FontProperties(family='sans-serif')

font = get_chinese_font()
plt.rcParams['axes.unicode_minus'] = False
plt.rcParams['font.family'] = font.get_name()

# ============================================================
# STEP 1: 定义漏斗数据
# ============================================================
# 如果存在 funnel_data.csv 则读取，否则使用教学演示数据
csv_path = Path('funnel_data.csv')
if csv_path.exists():
    df = pd.read_csv(csv_path)
    values = [
        df['visitors'].sum(),
        df['registrations'].sum(),
        df['trials'].sum(),
        df['payments'].sum(),
        df['renewals'].sum(),
    ]
else:
    print("⚠️ 未找到 funnel_data.csv，使用教学演示数据\n")
    values = [10000, 3500, 1200, 450, 280]

stages = ['访问首页', '注册账号', '开始试用', '完成付费', '续费']
colors = ['#00c8f0', '#7b5cf0', '#0eb87e', '#f09000', '#e04288']

# ============================================================
# STEP 2: 计算转化率
# ============================================================
print("=" * 60)
print("              用户转化漏斗分析报告")
print("=" * 60)
print()
print(f"{'漏斗阶段':<12} {'用户数':>10} {'转化率':>10} {'流失率':>10} {'留存率':>10}")
print("-" * 60)

rates = []
for i in range(len(stages)):
    if i == 0:
        ret_rate = 100.0
        print(f"{stages[i]:<10} {values[i]:>10,} {'—':>10} {'—':>10} {ret_rate:>9.1f}%")
    else:
        conv_rate = values[i] / values[i-1] * 100
        drop_rate = 100 - conv_rate
        ret_rate = values[i] / values[0] * 100
        rates.append(conv_rate)
        flag = '⚠️ 最大瓶颈' if i == 1 else ''
        print(f"{stages[i]:<10} {values[i]:>10,} {conv_rate:>8.1f}% {drop_rate:>9.1f}% {ret_rate:>9.1f}%  {flag}")

total_rate = values[-1] / values[0] * 100
print("-" * 60)
print(f"整体转化率（访问→续费）: {total_rate:.1f}%\n")

# ============================================================
# STEP 3: 生成漏斗图 (Funnel Chart)
# ============================================================
fig, axes = plt.subplots(1, 3, figsize=(18, 7))
fig.patch.set_facecolor('#0c1222')

# --- 图表 1：漏斗图 ---
ax1 = axes[0]
ax1.set_facecolor('#0c1222')
max_val = values[0]
y_pos = range(len(stages))
bar_heights = [v / max_val for v in values]

bars = ax1.barh(y_pos, bar_heights, height=0.6, color=colors, edgecolor='#1a2848', linewidth=1)
ax1.set_yticks(y_pos)
ax1.set_yticklabels(stages, fontproperties=font, fontsize=13, color='#e4e8f0')
ax1.invert_yaxis()
ax1.set_xlim(0, 1.05)

# 添加数值标签
for i, (v, h) in enumerate(zip(values, bar_heights)):
    ax1.text(h + 0.01, i, f'{v:,} 人', va='center', fontsize=13, color='#e4e8f0', fontproperties=font)
    if i > 0:
        cr = values[i] / values[i-1] * 100
        ax1.text(h + 0.01, i - 0.25, f'({cr:.1f}%)', va='center', fontsize=11, color='#96a0b8', fontproperties=font)

ax1.set_title('用户转化漏斗图', fontsize=16, color='#e4e8f0', pad=15, fontproperties=font)
ax1.tick_params(colors='#606c84')
for spine in ax1.spines.values():
    spine.set_visible(False)
ax1.xaxis.set_visible(False)

# --- 图表 2：转化率柱状图 ---
ax2 = axes[1]
ax2.set_facecolor('#0c1222')
conv_stages = ['访问→注册', '注册→试用', '试用→付费', '付费→续费']
bar_colors_2 = ['#00c8f0', '#7b5cf0', '#0eb87e', '#f09000']

bars2 = ax2.bar(conv_stages, rates, color=bar_colors_2, edgecolor='#1a2848', linewidth=1, width=0.55)

# 添加数值标签
for bar, rate in zip(bars2, rates):
    ax2.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1, f'{rate:.1f}%',
             ha='center', va='bottom', fontsize=13, fontweight='bold', color=bar_colors_2[rates.index(rate)] if rates.index(rate) < len(bar_colors_2) else '#fff')

# 行业基准线
ax2.axhline(y=60, color='#606c84', linestyle='--', linewidth=1.2, alpha=0.6)
ax2.text(3.3, 61.5, 'SaaS 行业基准 60%', fontsize=11, color='#606c84', ha='right', fontproperties=font)

ax2.set_ylim(0, 90)
ax2.set_ylabel('转化率 (%)', fontsize=13, color='#96a0b8', fontproperties=font)
ax2.set_title('各环节转化率', fontsize=16, color='#e4e8f0', pad=15, fontproperties=font)
ax2.tick_params(colors='#606c84', labelsize=12)
for spine in ax2.spines.values():
    spine.set_visible(False)
ax2.yaxis.grid(True, color='#172033', linewidth=0.5)
ax2.set_axisbelow(True)

# --- 图表 3：流失用户数量分析 ---
ax3 = axes[2]
ax3.set_facecolor('#0c1222')
loss_stages = ['访问→注册', '注册→试用', '试用→付费', '付费→续费']
loss_values = [values[0]-values[1], values[1]-values[2], values[2]-values[3], values[3]-values[4]]
loss_colors = ['#ef4444', '#f09000', '#f09000', '#0eb87e']

bars3 = ax3.bar(loss_stages, loss_values, color=loss_colors, edgecolor='#1a2848', linewidth=1, width=0.55)

for bar, lv in zip(bars3, loss_values):
    ax3.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 30, f'{lv:,}',
             ha='center', va='bottom', fontsize=13, fontweight='bold', color='#e4e8f0')

ax3.set_ylabel('流失用户数', fontsize=13, color='#96a0b8', fontproperties=font)
ax3.set_title('各环节流失用户数', fontsize=16, color='#e4e8f0', pad=15, fontproperties=font)
ax3.tick_params(colors='#606c84', labelsize=12)
for spine in ax3.spines.values():
    spine.set_visible(False)
ax3.yaxis.grid(True, color='#172033', linewidth=0.5)
ax3.set_axisbelow(True)

# 标记最大流失点
ax3.annotate('🔴 最大瓶颈\n6,500 人流失', xy=(0, loss_values[0]),
             xytext=(0.3, loss_values[0]*1.2),
             fontsize=12, color='#ef4444', fontproperties=font,
             arrowprops=dict(arrowstyle='->', color='#ef4444', lw=1.5))

plt.tight_layout(pad=2)
plt.savefig('funnel_analysis_charts.png', dpi=150, bbox_inches='tight',
            facecolor='#0c1222', edgecolor='none')
print("✅ 图表已保存: funnel_analysis_charts.png\n")

# ============================================================
# STEP 4: 优化效果预估
# ============================================================
print("=" * 60)
print("              优化效果预估")
print("=" * 60)
print()

scenario = {
    '当前转化率': [35.0, 34.3, 37.5, 62.2],
    '优化后转化率': [50.0, 34.3, 37.5, 62.2],  # 仅优化第一层
}

current_paid = values[3]
# 仅优化第一层（访问→注册 35%→50%），后续环节转化率不变
paid_rates = [0.50, 0.343, 0.375]  # 仅用前三层（到付费为止）
new_paid = int(values[0])
for r in paid_rates:
    new_paid = int(new_paid * r)

print(f"优化策略：仅优化「访问→注册」（35% → 50%）")
print(f"当前付费用户：{current_paid:,} 人")
print(f"优化后付费用户：{new_paid:,} 人")
print(f"增长：+{new_paid - current_paid:,} 人（+{(new_paid/current_paid - 1)*100:.0f}%）")
print()

# 三层转化（访问→注册→试用→付费）各优化5%
print("三层转化各优化 5% 的叠加效应（到付费为止）：")
all_opt = [0.40, 0.393, 0.425]
n = values[0]
for r in all_opt:
    n = int(n * r)
print(f"三层5%全优化后付费用户：{n:,} 人（+{n - current_paid:,} 人，+{(n/current_paid - 1)*100:.0f}%）")
print()

print("=" * 60)
print("分析完成！图表已保存为 funnel_analysis_charts.png")
print("可直接用于课程 PPT 展示")
print("=" * 60)
