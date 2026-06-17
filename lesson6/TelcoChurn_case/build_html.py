# -*- coding: utf-8 -*-
"""把 churn_data.json 注入 ECharts 模板，生成自包含 index.html"""
import json

with open("churn_data.json", encoding="utf-8") as f:
    DATA = f.read()

HTML = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>电信客户流失分析 · 数据可视化看板</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
         background:#0f1117; color:#e6e8ee; line-height:1.6; }
  .wrap { max-width:1280px; margin:0 auto; padding:32px 20px 60px; }
  header { text-align:center; margin-bottom:8px; }
  header h1 { font-size:30px; font-weight:700;
    background:linear-gradient(90deg,#4f9cff,#9b6bff); -webkit-background-clip:text;
    -webkit-text-fill-color:transparent; }
  header p { color:#8b93a7; margin-top:8px; font-size:14px; }
  .kpis { display:grid; grid-template-columns:repeat(5,1fr); gap:16px; margin:28px 0; }
  .kpi { background:#1a1d28; border:1px solid #262a38; border-radius:14px;
    padding:20px 16px; text-align:center; }
  .kpi .v { font-size:30px; font-weight:700; color:#4f9cff; }
  .kpi.warn .v { color:#ff6b6b; }
  .kpi .l { font-size:13px; color:#8b93a7; margin-top:6px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
  .card { background:#1a1d28; border:1px solid #262a38; border-radius:16px;
    padding:20px; margin-bottom:20px; }
  .card h2 { font-size:17px; margin-bottom:4px; display:flex; align-items:center; gap:8px;}
  .card .sub { font-size:13px; color:#8b93a7; margin-bottom:14px; }
  .chart { width:100%; height:340px; }
  .full { grid-column:1 / -1; }
  .badge { font-size:11px; background:#2a3142; color:#9bb4ff; padding:2px 8px;
    border-radius:6px; font-weight:500; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { padding:9px 10px; text-align:left; border-bottom:1px solid #262a38; white-space:nowrap;}
  th { color:#9bb4ff; font-weight:600; background:#161922; }
  td { color:#c7cbd6; }
  tr:hover td { background:#20242f; }
  .tag-yes { color:#ff6b6b; font-weight:600; }
  .tag-no { color:#4ade80; }
  .tablewrap { overflow-x:auto; }
  .findings { display:grid; grid-template-columns:repeat(2,1fr); gap:14px; }
  .finding { background:#161922; border-left:3px solid #4f9cff; border-radius:8px;
    padding:14px 16px; }
  .finding.danger { border-left-color:#ff6b6b; }
  .finding.good { border-left-color:#4ade80; }
  .finding h3 { font-size:15px; margin-bottom:6px; }
  .finding p { font-size:13px; color:#aeb4c2; }
  .action { background:linear-gradient(135deg,#1e2433,#1a1d28);
    border:1px solid #33405c; border-radius:12px; padding:16px 18px; margin-top:8px; }
  .action b { color:#9bb4ff; }
  footer { text-align:center; color:#5a6173; font-size:12px; margin-top:36px; }
  @media(max-width:880px){ .kpis{grid-template-columns:repeat(2,1fr)} .grid{grid-template-columns:1fr}
    .findings{grid-template-columns:1fr} }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>📞 电信客户流失分析看板</h1>
    <p>Telco Customer Churn · 探索性数据分析与商业洞察 · 数据集 7043 位客户</p>
  </header>

  <div class="kpis" id="kpis"></div>

  <!-- 数据预览 -->
  <div class="card full">
    <h2>🗂️ 数据预览 <span class="badge">前 8 行 / 关键字段</span></h2>
    <div class="sub">原始数据长这样。注意 TotalCharges 原本是文本型（伪数值），已清洗为数字。</div>
    <div class="tablewrap"><table id="preview"></table></div>
  </div>

  <div class="grid">
    <div class="card"><h2>① 合约类型 vs 流失率</h2>
      <div class="sub">头号因素：月付客户流失率是两年合约的 15 倍</div>
      <div class="chart" id="c_contract"></div></div>
    <div class="card"><h2>② 支付方式 vs 流失率</h2>
      <div class="sub">电子支票用户流失率畸高</div>
      <div class="chart" id="c_payment"></div></div>
    <div class="card"><h2>③ 在网月数分布（按是否流失分色）</h2>
      <div class="sub">新客户（0-6月）扎堆流失</div>
      <div class="chart" id="c_tenure"></div></div>
    <div class="card"><h2>④ 在网时长 vs 流失率</h2>
      <div class="sub">在网越久越忠诚，流失率单调下降</div>
      <div class="chart" id="c_tenurerate"></div></div>
    <div class="card"><h2>⑤ 月费分布箱线图</h2>
      <div class="sub">流失客户月费整体更高</div>
      <div class="chart" id="c_monthly"></div></div>
    <div class="card"><h2>⑥ 网络类型 vs 流失率</h2>
      <div class="sub">光纤用户反而最易流失</div>
      <div class="chart" id="c_internet"></div></div>
  </div>

  <div class="card full"><h2>🔥 流失风险因素排行榜 <span class="badge">Top 15</span></h2>
    <div class="sub">把所有特征拆成"特征=取值"，按流失率从高到低排序，一眼锁定高危人群</div>
    <div class="chart" id="c_ranking" style="height:520px"></div></div>

  <div class="card full"><h2>🔗 数值字段相关性热力图</h2>
    <div class="sub">tenure 与流失负相关（越久越不走），月费与流失正相关</div>
    <div class="chart" id="c_corr" style="height:380px"></div></div>

  <!-- 结论 -->
  <div class="card full">
    <h2>💡 关键发现与商业建议</h2>
    <div class="findings" id="findings"></div>
    <div class="action">
      <b>📈 挽留策略：</b>
      ① 用折扣/赠送服务，引导<b>月付客户</b>签订一/两年长约；
      ② 重点呵护<b>前 6 个月的新客户</b>（占流失主力），加强 onboarding；
      ③ 向高危用户推荐<b>在线安全 / 技术支持</b>等增值服务（绑定后更不易走）；
      ④ 排查<b>光纤 + 电子支票</b>组合用户的体验与账单问题。
    </div>
  </div>

  <footer>数据来源：IBM Telco Customer Churn · 由 pandas 清洗计算 + ECharts 渲染 · lesson6 教学案例</footer>
</div>

<script>
const DATA = __DATA__;
const C = { blue:'#4f9cff', red:'#ff6b6b', green:'#4ade80', purple:'#9b6bff',
            grid:'#262a38', text:'#aeb4c2' };
const baseAxis = { axisLine:{lineStyle:{color:'#3a4154'}}, axisLabel:{color:C.text},
                   splitLine:{lineStyle:{color:C.grid}} };

// KPI
const m = DATA.meta;
document.getElementById('kpis').innerHTML = [
  {v:m.rows.toLocaleString(), l:'客户总数'},
  {v:m.churn_rate+'%', l:'整体流失率', warn:true},
  {v:m.churn_count.toLocaleString(), l:'流失客户数', warn:true},
  {v:m.avg_tenure+' 月', l:'平均在网时长'},
  {v:'$'+m.avg_monthly, l:'平均月费'},
].map(k=>`<div class="kpi ${k.warn?'warn':''}"><div class="v">${k.v}</div><div class="l">${k.l}</div></div>`).join('');

// 预览表
const p = DATA.preview;
document.getElementById('preview').innerHTML =
  '<tr>'+p.columns.map(c=>`<th>${c}</th>`).join('')+'</tr>'+
  p.rows.map(r=>'<tr>'+r.map((v,i)=>{
    if(p.columns[i]==='Churn') return `<td class="${v==='Yes'?'tag-yes':'tag-no'}">${v}</td>`;
    return `<td>${v}</td>`;
  }).join('')+'</tr>').join('');

function show(id,opt){ const ch=echarts.init(document.getElementById(id),'dark');
  ch.setOption(opt); window.addEventListener('resize',()=>ch.resize()); }
const bg = {backgroundColor:'transparent'};

// 柱状图：流失率
function rateBar(id,arr,color){
  show(id,{...bg, tooltip:{trigger:'axis',
      formatter:p=>`${p[0].name}<br/>流失率 <b>${p[0].value}%</b><br/>样本 ${arr[p[0].dataIndex].n}`},
    grid:{left:50,right:20,top:20,bottom:60},
    xAxis:{type:'category',data:arr.map(d=>d.name),...baseAxis,
      axisLabel:{color:C.text,interval:0,rotate:arr.length>3?20:0,fontSize:11}},
    yAxis:{type:'value',name:'流失率%',max:50,...baseAxis},
    series:[{type:'bar',data:arr.map(d=>d.rate),itemStyle:{color,borderRadius:[6,6,0,0]},
      label:{show:true,position:'top',formatter:'{c}%',color:'#fff'},barWidth:'50%'}]});
}
rateBar('c_contract',DATA.contract,C.red);
rateBar('c_payment',DATA.payment,C.purple);
rateBar('c_internet',DATA.internet,'#f0a14b');
rateBar('c_tenurerate',DATA.tenure_rate,C.blue);

// tenure 堆叠分布
const t=DATA.tenure;
show('c_tenure',{...bg, tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},
  legend:{data:['流失','留存'],textStyle:{color:C.text},top:0},
  grid:{left:50,right:20,top:36,bottom:40},
  xAxis:{type:'category',data:t.labels,...baseAxis,name:'在网月数'},
  yAxis:{type:'value',name:'人数',...baseAxis},
  series:[
    {name:'流失',type:'bar',stack:'x',data:t.churn,itemStyle:{color:C.red}},
    {name:'留存',type:'bar',stack:'x',data:t.stay,itemStyle:{color:'#3b7d4f'}}]});

// 月费箱线
const b=DATA.monthly_box;
show('c_monthly',{...bg, tooltip:{trigger:'item'},
  grid:{left:50,right:20,top:20,bottom:40},
  xAxis:{type:'category',data:b.categories,...baseAxis},
  yAxis:{type:'value',name:'月费$',...baseAxis},
  series:[{type:'boxplot',data:b.data,
    itemStyle:{color:'#2a3142',borderColor:C.blue},
    emphasis:{itemStyle:{borderColor:C.red}}}]});

// 排行榜（横向）
const rk=DATA.ranking.slice().reverse();
show('c_ranking',{...bg, tooltip:{trigger:'axis',axisPointer:{type:'shadow'},
    formatter:p=>`${p[0].name}<br/>流失率 <b>${p[0].value}%</b><br/>样本 ${rk[p[0].dataIndex].n}`},
  grid:{left:160,right:50,top:10,bottom:30},
  xAxis:{type:'value',name:'流失率%',...baseAxis},
  yAxis:{type:'category',data:rk.map(d=>d.factor),...baseAxis,axisLabel:{color:C.text,fontSize:12}},
  series:[{type:'bar',data:rk.map(d=>d.rate),
    label:{show:true,position:'right',formatter:'{c}%',color:'#fff'},
    itemStyle:{borderRadius:[0,5,5,0],
      color:p=>{const v=p.value;return v>=40?'#ff6b6b':v>=30?'#f0a14b':'#4f9cff';}}}]});

// 相关性热力图
const cr=DATA.corr;
show('c_corr',{...bg, tooltip:{position:'top',
    formatter:p=>`${cr.labels[p.data[0]]} × ${cr.labels[p.data[1]]}<br/>相关系数 <b>${p.data[2]}</b>`},
  grid:{left:110,right:20,top:20,bottom:80},
  xAxis:{type:'category',data:cr.labels,...baseAxis,axisLabel:{color:C.text,rotate:25}},
  yAxis:{type:'category',data:cr.labels,...baseAxis},
  visualMap:{min:-1,max:1,calculable:true,orient:'horizontal',left:'center',bottom:10,
    inRange:{color:['#ff6b6b','#1a1d28','#4f9cff']},textStyle:{color:C.text}},
  series:[{type:'heatmap',data:cr.data,
    label:{show:true,color:'#fff',formatter:p=>p.data[2]},
    emphasis:{itemStyle:{shadowBlur:10,shadowColor:'rgba(0,0,0,0.5)'}}}]});

// 结论卡片
const F=[
  {c:'danger',t:'合约类型是头号杀手',d:`月付客户流失率 <b>${DATA.contract[0].rate}%</b>，而两年合约仅 <b>${DATA.contract[2].rate}%</b>，相差约 15 倍。`},
  {c:'danger',t:'新客户最危险',d:`在网 0-6 个月的客户流失率高达 <b>${DATA.tenure_rate[0].rate}%</b>，是 4 年以上老客户的 5 倍多。`},
  {c:'',t:'电子支票 = 高危信号',d:`用电子支票付款的客户流失率 <b>${DATA.payment.find(x=>x.name.includes('Electronic')).rate}%</b>，远高于自动扣款用户。`},
  {c:'good',t:'增值服务能"绑住"客户',d:`没开通在线安全/技术支持的客户流失率超 40%，开通后明显下降——服务越多越难离开。`},
];
document.getElementById('findings').innerHTML = F.map(f=>
  `<div class="finding ${f.c}"><h3>${f.t}</h3><p>${f.d}</p></div>`).join('');
</script>
</body>
</html>"""

html = HTML.replace("__DATA__", DATA)
with open("index.html", "w", encoding="utf-8") as f:
    f.write(html)
print(f"网页已生成 -> index.html ({len(html)//1024} KB)")
