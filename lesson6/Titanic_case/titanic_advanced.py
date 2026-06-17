# -*- coding: utf-8 -*-
"""泰坦尼克号 进阶可视化：特征工程 + 多维分析（精选6图）"""
import warnings
warnings.filterwarnings("ignore")
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

for f in ["Arial Unicode MS", "PingFang SC", "Heiti TC", "STHeiti", "SimHei"]:
    try:
        plt.rcParams["font.sans-serif"] = [f]; break
    except Exception:
        continue
plt.rcParams["axes.unicode_minus"] = False

df = pd.read_csv("train.csv")
df["Age"] = df["Age"].fillna(df["Age"].median())
df["Embarked"] = df["Embarked"].fillna(df["Embarked"].mode()[0])
df["Fare"] = df["Fare"].fillna(df["Fare"].median())

# ===== 特征工程 =====
# 1) 头衔
df["Title"] = df["Name"].str.extract(r",\s*([^.]+)\.")
title_map = {
    "Mr": "Mr", "Miss": "Miss", "Mrs": "Mrs", "Master": "Master",
    "Mlle": "Miss", "Ms": "Miss", "Mme": "Mrs",
}
df["Title"] = df["Title"].map(lambda t: title_map.get(t, "Rare"))

# 2) 家庭规模
df["FamilySize"] = df["SibSp"] + df["Parch"] + 1
def fam_bucket(n):
    if n == 1: return "独自一人"
    if n <= 4: return "小家庭(2-4)"
    return "大家庭(5+)"
df["FamilyGroup"] = df["FamilySize"].apply(fam_bucket)

# 3) 年龄分段
df["AgeBand"] = pd.cut(df["Age"], bins=[0, 12, 18, 35, 60, 100],
                       labels=["儿童", "青少年", "青年", "中年", "老年"])

# ===== 绘图 =====
fig, axes = plt.subplots(2, 3, figsize=(19, 11))
fig.suptitle("泰坦尼克号 进阶可视化：特征工程与多维分析", fontsize=19, fontweight="bold")

def bar_rate(ax, series, title, order=None, palette=None):
    if order is not None:
        series = series.reindex(order)
    colors = palette if palette is not None else plt.cm.viridis(np.linspace(0.2, 0.8, len(series)))
    bars = ax.bar(series.index.astype(str), series.values, color=colors)
    ax.set_title(title, fontsize=13)
    ax.set_ylabel("生存率"); ax.set_ylim(0, 1)
    for b, v in zip(bars, series.values):
        if not np.isnan(v):
            ax.text(b.get_x()+b.get_width()/2, v+0.02, f"{v:.0%}", ha="center", fontsize=10)

# 图1：头衔 vs 生存率
t_order = ["Mr", "Mrs", "Miss", "Master", "Rare"]
bar_rate(axes[0,0], df.groupby("Title")["Survived"].mean(),
         "① 头衔(Title) 生存率 —— 从姓名提取", order=t_order,
         palette=["#1f77b4", "#e377c2", "#ff69b4", "#2ca02c", "#7f7f7f"])
cnt = df["Title"].value_counts().reindex(t_order)
axes[0,0].set_xticklabels([f"{t}\n(n={int(cnt[t])})" for t in t_order])

# 图2：家庭规模 vs 生存率（U型）
bar_rate(axes[0,1], df.groupby("FamilyGroup")["Survived"].mean(),
         "② 家庭规模 生存率 —— U型关系",
         order=["独自一人", "小家庭(2-4)", "大家庭(5+)"],
         palette=["#d62728", "#2ca02c", "#ff7f0e"])

# 图3：登船港口 vs 生存率
bar_rate(axes[0,2], df.groupby("Embarked")["Survived"].mean(),
         "③ 登船港口 生存率 (C瑟堡/Q皇后镇/S南安普顿)",
         order=["C", "Q", "S"], palette=["#17becf", "#bcbd22", "#9467bd"])

# 图4：票价区间 vs 生存率
df["FareBand"] = pd.qcut(df["Fare"], 4, labels=["低", "中低", "中高", "高"])
bar_rate(axes[1,0], df.groupby("FareBand")["Survived"].mean(),
         "④ 票价区间 生存率 (四等分)",
         order=["低", "中低", "中高", "高"],
         palette=plt.cm.YlOrRd(np.linspace(0.3, 0.9, 4)))

# 图5：年龄分段 vs 生存率
bar_rate(axes[1,1], df.groupby("AgeBand")["Survived"].mean(),
         "⑤ 年龄分段 生存率",
         order=["儿童", "青少年", "青年", "中年", "老年"],
         palette=plt.cm.coolwarm(np.linspace(0.1, 0.9, 5)))

# 图6：相关性热力图
ax = axes[1,2]
num_cols = ["Survived", "Pclass", "Age", "SibSp", "Parch", "Fare", "FamilySize"]
corr = df[num_cols].corr()
im = ax.imshow(corr.values, cmap="RdBu_r", vmin=-1, vmax=1)
ax.set_xticks(range(len(num_cols))); ax.set_xticklabels(num_cols, rotation=45, ha="right", fontsize=9)
ax.set_yticks(range(len(num_cols))); ax.set_yticklabels(num_cols, fontsize=9)
ax.set_title("⑥ 数值字段 相关性热力图", fontsize=13)
for i in range(len(num_cols)):
    for j in range(len(num_cols)):
        v = corr.values[i, j]
        ax.text(j, i, f"{v:.2f}", ha="center", va="center", fontsize=8,
                color="white" if abs(v) > 0.5 else "black")
fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)

plt.tight_layout(rect=[0, 0, 1, 0.96])
plt.savefig("titanic_advanced.png", dpi=120, bbox_inches="tight")
print("图表已保存：titanic_advanced.png\n")

# ===== 文字结论 =====
print("=" * 60)
print("进阶分析 关键发现")
print("=" * 60)
tr = df.groupby("Title")["Survived"].mean()
fr = df.groupby("FamilyGroup")["Survived"].mean()
er = df.groupby("Embarked")["Survived"].mean()
print(f"""
① 头衔：Mrs {tr['Mrs']:.0%} / Miss {tr['Miss']:.0%} / Master(小男孩) {tr['Master']:.0%}
   远高于 Mr(成年男性) {tr['Mr']:.0%} —— 「妇女儿童优先」在数据里清晰可见。
② 家庭规模呈U型：小家庭 {fr['小家庭(2-4)']:.0%} 最高，
   独行 {fr['独自一人']:.0%}、大家庭 {fr['大家庭(5+)']:.0%} 都偏低。
③ 港口：C港(瑟堡) {er['C']:.0%} 明显高于 S港 {er['S']:.0%}，
   因为瑟堡上船的多为富裕的1等舱乘客。
④ 票价越高生存率越高；⑤ 儿童生存率最高。
⑥ 相关性：Fare 与生存正相关，Pclass 与生存负相关(舱位数字越小越高级)。
""")
