# -*- coding: utf-8 -*-
"""生成电信客户流失分析的自包含网页应用 (index.html)。
   先用 pandas 算好所有指标，再把结果嵌入 ECharts 页面。"""
import warnings
warnings.filterwarnings("ignore")
import json
import pandas as pd
import numpy as np

df = pd.read_csv("Telco-Churn.csv")

# ---------- 数据清洗 ----------
# TotalCharges 是伪数值（文本含空格），转数值并用中位数填充
df["TotalCharges"] = pd.to_numeric(df["TotalCharges"].astype(str).str.strip(),
                                   errors="coerce")
n_blank = int(df["TotalCharges"].isna().sum())
df["TotalCharges"] = df["TotalCharges"].fillna(df["TotalCharges"].median())

churn = (df["Churn"] == "Yes")
N = len(df)

D = {}  # 最终要嵌入网页的数据

# ---------- 概览 KPI ----------
D["meta"] = {
    "rows": N,
    "cols": df.shape[1],
    "churn_rate": round(churn.mean() * 100, 1),
    "churn_count": int(churn.sum()),
    "stay_count": int((~churn).sum()),
    "blank_total": n_blank,
    "avg_tenure": round(df["tenure"].mean(), 1),
    "avg_monthly": round(df["MonthlyCharges"].mean(), 1),
}

def rate_by(col, order=None):
    """按某列分组的流失率(%)与样本数"""
    g = df.groupby(col).agg(rate=("Churn", lambda s: (s == "Yes").mean() * 100),
                            n=("Churn", "size"))
    if order:
        g = g.reindex(order)
    return [{"name": str(i), "rate": round(r.rate, 1), "n": int(r.n)}
            for i, r in g.iterrows()]

# ---------- 分组流失率 ----------
D["contract"] = rate_by("Contract",
                        ["Month-to-month", "One year", "Two year"])
D["payment"] = rate_by("PaymentMethod")
D["internet"] = rate_by("InternetService", ["DSL", "Fiber optic", "No"])

# ---------- 流失率排行榜（多因素，找最危险特征）----------
ranking = []
factors = {
    "Contract": "合约类型", "PaymentMethod": "支付方式",
    "InternetService": "网络类型", "OnlineSecurity": "在线安全",
    "TechSupport": "技术支持", "OnlineBackup": "在线备份",
    "DeviceProtection": "设备保护", "Dependents": "有家属",
    "Partner": "有配偶", "PaperlessBilling": "电子账单",
    "SeniorCitizen": "老年用户",
}
for col, label in factors.items():
    tmp = df.copy()
    if col == "SeniorCitizen":
        tmp[col] = tmp[col].map({1: "Yes", 0: "No"})
    g = tmp.groupby(col).agg(rate=("Churn", lambda s: (s == "Yes").mean() * 100),
                             n=("Churn", "size"))
    for val, r in g.iterrows():
        ranking.append({"factor": f"{label}={val}",
                        "rate": round(r.rate, 1), "n": int(r.n)})
ranking.sort(key=lambda x: x["rate"], reverse=True)
D["ranking"] = ranking[:15]  # 前15高危

# ---------- tenure 在网月数分布（按是否流失分色）----------
bins = list(range(0, 78, 6))
labels = [f"{b}-{b+6}" for b in bins[:-1]]
tcut = pd.cut(df["tenure"], bins=bins, labels=labels, include_lowest=True)
D["tenure"] = {
    "labels": labels,
    "churn": [int(((tcut == l) & churn).sum()) for l in labels],
    "stay": [int(((tcut == l) & ~churn).sum()) for l in labels],
}

# ---------- 按 tenure 分桶的流失率曲线 ----------
tb = pd.cut(df["tenure"], [0, 6, 12, 24, 48, 72],
            labels=["0-6月", "6-12月", "1-2年", "2-4年", "4年+"],
            include_lowest=True)
g = df.groupby(tb).agg(rate=("Churn", lambda s: (s == "Yes").mean() * 100))
D["tenure_rate"] = [{"name": str(i), "rate": round(r.rate, 1)}
                    for i, r in g.iterrows()]

# ---------- 月费分布（按是否流失，箱线统计）----------
def box_stats(s):
    q1, q2, q3 = s.quantile([.25, .5, .75])
    iqr = q3 - q1
    lo = max(s.min(), q1 - 1.5 * iqr)
    hi = min(s.max(), q3 + 1.5 * iqr)
    return [round(x, 1) for x in [lo, q1, q2, q3, hi]]
D["monthly_box"] = {
    "categories": ["流失客户", "留存客户"],
    "data": [box_stats(df.loc[churn, "MonthlyCharges"]),
             box_stats(df.loc[~churn, "MonthlyCharges"])],
}

# ---------- 相关性热力图（数值字段 + 流失）----------
num = df[["tenure", "MonthlyCharges", "TotalCharges", "SeniorCitizen"]].copy()
num["Churn"] = churn.astype(int)
corr = num.corr()
cols = list(corr.columns)
D["corr"] = {
    "labels": cols,
    "data": [[i, j, round(corr.iloc[j, i], 2)]
             for i in range(len(cols)) for j in range(len(cols))],
}

# ---------- 数据预览样本（前 8 行关键列）----------
prev_cols = ["customerID", "gender", "SeniorCitizen", "tenure", "Contract",
             "PaymentMethod", "MonthlyCharges", "TotalCharges", "Churn"]
D["preview"] = {
    "columns": prev_cols,
    "rows": df[prev_cols].head(8).round(2).astype(str).values.tolist(),
}

# ---------- 写出 JSON ----------
with open("churn_data.json", "w", encoding="utf-8") as f:
    json.dump(D, f, ensure_ascii=False)
print("指标计算完成 -> churn_data.json")
print(f"  规模 {N} 行 | 流失率 {D['meta']['churn_rate']}% | TotalCharges 空值 {n_blank} 个")
print(f"  最高危因素: {D['ranking'][0]['factor']} = {D['ranking'][0]['rate']}%")
