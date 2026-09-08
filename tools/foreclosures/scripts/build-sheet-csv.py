#!/usr/bin/env python3
"""One-sheet CSV for Google Sheets import: summary block (formulas) + sale calendar + all cases with per-row formulas.
Usage: python3 scripts/build-sheet-csv.py out/2026-09-08 out/2026-10-05 -o reports/SC-foreclosures.csv"""
import json, sys, glob, os, re, csv, io
from datetime import datetime, date
args=sys.argv[1:]; out='sheet.csv'
STATIC='--static' in args
if STATIC: args.remove('--static')
if '-o' in args: i=args.index('-o'); out=args[i+1]; del args[i:i+2]
dirs=args or sorted(glob.glob('out/*'))
def money(s):
    if s is None or s=='': return None
    m=re.search(r'-?[\d,]+(?:\.\d+)?', str(s).replace('$','')); return float(m.group(0).replace(',','')) if m else None
def pdate(s):
    if not s: return ''
    t=re.sub(r'^[A-Za-z]+day,?\s+','',str(s)).replace(',',', ').replace('  ',' ').strip()
    for f in ('%B %d, %Y','%m/%d/%Y','%B %d %Y','%Y-%m-%d'):
        try: return datetime.strptime(t,f).strftime('%m/%d/%Y')
        except: pass
    return ''
COLS=['County','Sale date','Sale #','Case #','Status','Address','TMS','Plaintiff','Defendant','Deficiency','Judgment $','As of','Per diem $','Days to sale','Est. owed sale day $','Interest','County FMV $','Debt ÷ FMV','Acreage','Land use / type','Year built','Sq ft','Record owner','Last sale','Order / judgment','Notice','Docket','Property card','Write-up']
rows=[]
for d in dirs:
    for f in sorted(glob.glob(os.path.join(d,'*.json'))):
        st=json.load(open(f)); county=st['county']
        for r in st['rows']:
            j=r.get('judgment') or {}; p=r.get('property') or {}; n=r.get('notice') or {}; s=r.get('sources') or {}
            link=lambda u: str(u) if u and str(u).startswith('http') else ''   # plain URLs – Sheets auto-links them
            rows.append([county.title(), pdate(r.get('saleDate') or st.get('saleDate')) or pdate(os.path.basename(d)), r.get('saleNo') or '', r.get('caseNo'), r.get('status'), r.get('address'), r.get('tms') or n.get('tms') or '', r.get('plaintiff'), r.get('defendant'),
                (r.get('deficiency') or j.get('deficiency') or n.get('deficiency') or 'unknown'), j.get('totalDebt') if j.get('totalDebt') is not None else '', pdate(j.get('asOfDate')), j.get('perDiem') if j.get('perDiem') is not None else '', '', '', j.get('interestRate') or n.get('bidInterestRate') or '',
                money(p.get('fmv') or p.get('assessed')) or '', '', p.get('acreage') or '', p.get('landUse') or p.get('buildingType') or '', p.get('yearBuilt') or '', p.get('sqft') or '', p.get('owner') or '',
                ' '.join(x for x in [p.get('deedDate') or p.get('lastSaleDate'), p.get('lastSalePrice')] if x), link(j.get('source') or s.get('orderPdf')), link(s.get('notice') or s.get('advert') or n.get('source')), link((r.get('index') or {}).get('url')), link(p.get('source')), r.get('writeup') or ''])
rows.sort(key=lambda r:(r[1],r[0],r[2] if isinstance(r[2],int) else 999,r[3]))
HDR=14; first=HDR+1; last=HDR+len(rows)
grid=[]
grid.append(['SC Master-in-Equity foreclosure sales — master sheet', '', '', f'generated {date.today().isoformat()} from the hello-world repo (tools/foreclosures). Judgment $ = court-entered total; Est. owed = judgment + per diem × days to sale (plaintiff\'s credit-bid ceiling, not the opening bid). Deficiency demanded = bidding stays open 30 days.'])
grid.append(['County','Cases','Scheduled','Cancelled / withdrawn','Deficiency demanded','Deficiency waived','With judgment $','Total judgment $ (scheduled)','With FMV','','SALE CALENDAR','Day rule','Time','Location','Next dates','Notes'])
CAL=[('Greenville','1st Monday (Tue if holiday)','11:00 AM','Greenville County Courthouse, 305 E North St','Sep 8 · Oct 5 · Nov 2 · Dec 7 2026','5% deposit; deficiency re-bid day 30 (Oct 8)'),
 ('Pickens','1st Monday (Tue if holiday)','11:00 AM','Pickens County Courthouse, 2nd floor, Courtroom #1','Sep 8 · Oct 5 · Nov 2 · Dec 7 2026','Deficiency re-bid Oct 8 2026 11:00 AM, Courtroom #4 or #2'),
 ('Spartanburg','1st Monday (Tue if holiday)','11:00 AM','180 Magnolia St, 4th floor, Courtroom 4-A','Sep 8 · Oct 5 · Nov 2 · Dec 7 2026','Deficiency sales ~30 days later'),
 ('Oconee','1st Monday (Tue if holiday)','11:00 AM','Oconee County Courthouse, Walhalla','Sep 8 · Oct 5 · Nov 2 · Dec 7 2026','List on the SC Public Index roster'),
 ('Horry','1st Monday (Tue if holiday)','11:00 AM','1301 2nd Ave, 3rd floor, Conway','Sep 8 · Oct 5 · Nov 2 · Dec 7 2026','New bidders register 7 days ahead; first-time winners bring $2,500 certified'),
 ('Charleston','1st TUESDAY','11:00 AM','Council Chambers, PSB, 4045 Bridge View Dr, N. Charleston','Oct 6 · Nov 3 · Dec 1 2026','REGISTER by noon the Monday before; re-open sales Thursdays at 100 Broad St Courtroom 2A'),
 ('Georgetown','1st Monday','12:00 NOON','401 Cleland St, 2nd floor','Sep 8 (confirm) · Oct 5 · Nov 2 · Dec 7 2026','Holiday rule "next day or next Monday" – confirm September (843-546-3103)'),
 ('Beaufort','1st Monday (next business day if holiday)','11:00 AM','102 Ribaut Rd, 2nd floor, Beaufort','Sep 8 · Oct 5 · Nov 2 · Dec 7 2026','Notebook outside MIE office + Public Index roster'),
 ('Berkeley','1st WEDNESDAY','11:00 AM','Courtroom B, 300-B California Ave, Moncks Corner','Oct 7 · Nov 4 · Dec 2 2026','MIE (843) 719-4432'),
 ('Dorchester','UNVERIFIED – assumed 1st Monday','11:00 AM (assumed)','St. George courthouse','Oct 5 · Nov 2 · Dec 7 (confirm)','Clerk (843) 563-0120'),
 ('Colleton','UNVERIFIED – assumed 1st Monday','11:00 AM (assumed)','Walterboro courthouse','Oct 5 · Nov 2 · Dec 7 (confirm)','Clerk (843) 549-5791')]
counties=sorted({r[0] for r in rows})
def d(s):
    try: return datetime.strptime(s,'%m/%d/%Y').date()
    except: return None
if STATIC:
    for r in rows:
        sd, ao = d(r[1]), d(r[11])
        days = max(0,(sd-ao).days) if sd and ao else ''
        r[13]=days
        r[14]=round(r[10] + (r[12] or 0)*(days or 0),2) if r[10]!='' else ''
        r[17]=round(r[14]/r[16],3) if r[14]!='' and r[16]!='' and r[16] else ''
A=f'$A${first}:$A${last}'; E=f'$E${first}:$E${last}'; J=f'$J${first}:$J${last}'; K=f'$K${first}:$K${last}'; Q=f'$Q${first}:$Q${last}'
for i in range(max(len(counties)+1, len(CAL))):
    rr=3+i; line=['']*16
    if i < len(counties):
        c=counties[i]
        if STATIC:
            cr=[r for r in rows if r[0]==c]; sch=[r for r in cr if r[4]=='scheduled']
            line[0:9]=[c, len(cr), len(sch), len(cr)-len(sch), sum(1 for r in cr if r[9]=='demanded'), sum(1 for r in cr if r[9]=='waived'), sum(1 for r in cr if r[10]!=''), round(sum(r[10] for r in sch if r[10]!=''),2), sum(1 for r in cr if r[16]!='')]
        else:
            line[0:9]=[c, f'=COUNTIF({A},A{rr})', f'=COUNTIFS({A},A{rr},{E},"scheduled")', f'=B{rr}-C{rr}', f'=COUNTIFS({A},A{rr},{J},"demanded")', f'=COUNTIFS({A},A{rr},{J},"waived")', f'=COUNTIFS({A},A{rr},{K},">0")', f'=SUMIFS({K},{A},A{rr},{E},"scheduled")', f'=COUNTIFS({A},A{rr},{Q},">0")']
    elif i == len(counties):
        t=3+len(counties)
        if STATIC:
            tot=['Total']; 
            for col in range(1,9): tot.append(round(sum(g[col] for g in grid[2:2+len(counties)] if isinstance(g[col],(int,float))),2))
            line[0:9]=tot
        else: line[0:9]=['Total']+[f'=SUM({col}3:{col}{t-1})' for col in 'BCDEFGHI']
    if i < len(CAL): line[10:16]=list(CAL[i])
    grid.append(line)
while len(grid) < HDR-1: grid.append([])
grid.append(COLS)
for k,r in enumerate(rows, start=first):
    r=list(r)
    if not STATIC:
        r[13]=f'=IF(L{k}="","",MAX(0,B{k}-L{k}))'
        r[14]=f'=IF(K{k}="","",K{k}+N(M{k})*N(N{k}))'
        r[17]=f'=IFERROR(O{k}/Q{k},"")'
    grid.append(r)
with open(out,'w',newline='') as f:
    w=csv.writer(f, quoting=csv.QUOTE_MINIMAL)
    for g in grid: w.writerow(g)
print('wrote',out,'cases',len(rows),'bytes',os.path.getsize(out))
