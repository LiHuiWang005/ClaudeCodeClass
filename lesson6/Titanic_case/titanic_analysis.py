# -*- coding: utf-8 -*-
"""泰坦尼克号生存率 探索性数据分析 (EDA)"""
import warnings
warnings.filterwarnings("ignore")
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# 中文显示
for f in ["Arial Unicode MS", "PingFang SC", "Heiti TC", "STHeiti", "SimHei"]:
    try:
        plt.rcParams["font.sans-serif"] = [f]
        break
    except Exception:
        continue
plt.rcParams["axes.unicode_minus"] = False

df = pd.read_csv("train.csv")
print("=" * 60)
print(f"数据集规模：{df.shape[0]} 行 × {df.shape[1]} 列")
print("=" * 60)

# ---------- 1. 缺失值检查 ----------
print("\n【1】各列缺失值数量与占比")
miss = df.isnull().sum()
miss_pct = (miss / len(df) * 100).round(1)
miss_tbl = pd.DataFrame({"缺失数量": miss, "缺失占比(%)": miss_pct})
print(miss_tbl[miss_tbl["缺失数量"] > 0].to_string())

# ---------- 2. 缺失值填充 ----------
age_median = df["Age"].median()
emb_mode = df["Embarked"].mode()[0]
df["Age"] = df["Age"].fillna(age_median)
df["Embarked"] = df["Embarked"].fillna(emb_mode)
print(f"\n【2】Age 用中位数填充：{age_median} 岁")
print(f"     Embarked 用众数填充：{emb_mode} 港")
print(f"     填充后剩余缺失（除 Cabin）：{df.drop(columns=['Cabin']).isnull().sum().sum()}")

# ---------- 3. 分组生存率 ----------
print("\n【3】分组生存率")
overall = df["Survived"].mean()
print(f"整体生存率：{overall:.1%}")

by_pclass = df.groupby("Pclass")["Survived"].mean()
print("\n按舱位等级：")
for k, v in by_pclass.items():
    print(f"  {k}等舱：{v:.1%}")

by_sex = df.groupby("Sex")["Survived"].mean()
print("\n按性别：")
for k, v in by_sex.items():
    print(f"  {'女性' if k=='female' else '男性'}：{v:.1%}")

print("\n按舱位×性别交叉：")
pivot = df.pivot_table(values="Survived", index="Pclass", columns="Sex", aggfunc="mean")
print((pivot * 100).round(1).to_string())

# ---------- 4. 绘图 ----------
fig, axes = plt.subplots(2, 2, figsize=(14, 11))
fig.suptitle("泰坦尼克号生存率分析", fontsize=18, fontweight="bold")

# a. 舱位等级生存率柱状图
ax = axes[0, 0]
bars = ax.bar([f"{i}等舱" for i in by_pclass.index], by_pclass.values,
              color=["#d4af37", "#9aa0a6", "#cd7f32"])
ax.set_title("不同舱位等级的生存率", fontsize=13)
ax.set_ylabel("生存率")
ax.set_ylim(0, 1)
for b, v in zip(bars, by_pclass.values):
    ax.text(b.get_x() + b.get_width() / 2, v + 0.02, f"{v:.1%}", ha="center", fontsize=11)

# b. 性别生存率对比
ax = axes[0, 1]
labels = ["女性" if s == "female" else "男性" for s in by_sex.index]
bars = ax.bar(labels, by_sex.values, color=["#e377c2", "#1f77b4"])
ax.set_title("不同性别的生存率对比", fontsize=13)
ax.set_ylabel("生存率")
ax.set_ylim(0, 1)
for b, v in zip(bars, by_sex.values):
    ax.text(b.get_x() + b.get_width() / 2, v + 0.02, f"{v:.1%}", ha="center", fontsize=11)

# c. 年龄分布直方图（按生存状态分色）
ax = axes[1, 0]
bins = np.arange(0, 81, 5)
ax.hist(df[df["Survived"] == 0]["Age"], bins=bins, alpha=0.6, label="遇难", color="#d62728")
ax.hist(df[df["Survived"] == 1]["Age"], bins=bins, alpha=0.6, label="生还", color="#2ca02c")
ax.set_title("年龄分布（按生存状态分色）", fontsize=13)
ax.set_xlabel("年龄")
ax.set_ylabel("人数")
ax.legend()

# d. 舱位×性别 热力图
ax = axes[1, 1]
im = ax.imshow(pivot.values, cmap="RdYlGn", vmin=0, vmax=1, aspect="auto")
ax.set_xticks(range(len(pivot.columns)))
ax.set_xticklabels(["女性" if c == "female" else "男性" for c in pivot.columns])
ax.set_yticks(range(len(pivot.index)))
ax.set_yticklabels([f"{i}等舱" for i in pivot.index])
ax.set_title("舱位 × 性别 生存率", fontsize=13)
for i in range(pivot.shape[0]):
    for j in range(pivot.shape[1]):
        ax.text(j, i, f"{pivot.values[i, j]:.0%}", ha="center", va="center", fontsize=12)
fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)

plt.tight_layout(rect=[0, 0, 1, 0.96])
plt.savefig("titanic_analysis.png", dpi=120, bbox_inches="tight")
print("\n【4】图表已保存：titanic_analysis.png")

# ---------- 5. 关键发现 ----------
print("\n" + "=" * 60)
print("【5】关键发现")
print("=" * 60)
print(f"""
1. 性别是最强预测因子：女性生存率 {by_sex['female']:.0%}，男性仅 {by_sex['male']:.0%}，
   体现了「妇女儿童优先」的逃生原则。
2. 舱位等级影响显著：1等舱 {by_pclass[1]:.0%} → 2等舱 {by_pclass[2]:.0%} → 3等舱 {by_pclass[3]:.0%}，
   社会经济地位与生存机会高度相关。
3. 最极端对比：1等舱女性生存率 {pivot.loc[1,'female']:.0%}，3等舱男性仅 {pivot.loc[3,'male']:.0%}。
4. 年龄方面：儿童（<10岁）生存率偏高，青壮年男性遇难最多。
""")
