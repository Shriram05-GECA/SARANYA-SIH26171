"""Generates the SYNTHETIC evaluation dataset (pages + images + ground truth). Deterministic (seeded). No real data."""
import json, random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1] / "dataset"
(ROOT / "pages").mkdir(parents=True, exist_ok=True); (ROOT / "images").mkdir(parents=True, exist_ok=True)
rnd = random.Random(2026)
FIRST = ["Aarav", "Meera", "Rohan", "Ananya", "Vikram", "Sneha", "Karthik", "Ishita", "Arjun", "Priya", "Neha", "Rahul", "Divya", "Siddharth"]
LAST = ["Sharma", "Nair", "Kulkarni", "Iyer", "Patil", "Reddy", "Deshmukh", "Verma", "Menon", "Joshi", "Gupta", "Bose"]
CITY = ["Pune 411001", "Mumbai 400001", "Nashik 422001", "Nagpur 440001", "Kochi 682001"]
STREET = ["MG Road", "Lake View Street", "Park Avenue", "Temple Road", "Station Lane"]


def luhn_card():
    d = [4] + [rnd.randint(0, 9) for _ in range(14)]
    s = 0
    for i, x in enumerate(reversed(d)):
        x = x * 2 if i % 2 == 0 else x
        s += x - 9 if x > 9 else x
    d.append((10 - s % 10) % 10)
    g = "".join(map(str, d))
    return " ".join(g[i:i + 4] for i in range(0, 16, 4))


def person():
    f, l = rnd.choice(FIRST), rnd.choice(LAST)
    ph = str(rnd.choice("6789")) + "".join(str(rnd.randint(0, 9)) for _ in range(9))
    if rnd.random() < 0.3: ph = "+91 " + ph[:5] + " " + ph[5:]
    aad = str(rnd.randint(2, 9)) + "".join(str(rnd.randint(0, 9)) for _ in range(3))
    aad = f"{aad} {rnd.randint(1000, 9999)} {rnd.randint(1000, 9999)}"
    return {
        "name": f"{f} {l}", "email": f"{f.lower()}.{l.lower()}{rnd.randint(1, 99)}@{rnd.choice(['example.com', 'example.org', 'mail.example.in'])}",
        "phone": ph, "address": f"{rnd.randint(1, 999)} {rnd.choice(STREET)}, {rnd.choice(CITY)}",
        "account": "".join(str(rnd.randint(0, 9)) for _ in range(rnd.choice([10, 12, 14]))),
        "pan": "".join(rnd.choice("ABCDEFGHJKLMNPQRSTUVWXYZ") for _ in range(5)) + f"{rnd.randint(1000, 9999)}" + rnd.choice("ABCDEFGHJK"),
        "aadhaar": aad, "card": luhn_card(), "application_id": f"APP-2026-{rnd.randint(1, 999):03d}",
        "dob": f"{rnd.randint(1, 28):02d}/{rnd.randint(1, 12):02d}/{rnd.randint(1985, 2004)}", "ifsc": "EXMP0" + f"{rnd.randint(0, 999999):06d}",
    }


LABELS = {"name": "Name", "email": "Email", "phone": "Mobile", "address": "Address", "account": "Account Number", "pan": "PAN", "aadhaar": "Aadhaar",
          "card": "Debit Card Number", "application_id": "Application ID", "dob": "Date of Birth", "ifsc": "IFSC"}
KEEP_FIELDS = [("Status", "Approved"), ("Account type", "Savings"), ("Bank Name", "Example Bank"), ("Branch", "Pune Main"), ("Scheme", "Student Digital Skills Grant"),
               ("Interest rate", "7.5% p.a."), ("Loan amount", "₹5,00,000.00"), ("Last updated", "2026-01-22"), ("Order total", "₹2,499.00"), ("Version", "2.4.1")]
BUTTONS = ["View Details", "Transaction History", "Download", "Logout", "Contact Support", "Renew Now", "Apply Filters"]
NAV = ["Home", "My Applications", "Documents", "Card Offers", "Support"]

VARIANTS = ["dl", "table", "div", "inline", "cols"]


def render_field(style, label, value, i):
    if style == "dl": return f"<dl><dt>{label}</dt><dd>{value}</dd></dl>"
    if style == "table": return f"<table><tr><th>{label}</th><td>{value}</td></tr></table>"
    if style == "div": return f'<div class="r"><span class="l">{label}</span><span class="v">{value}</span></div>'
    if style == "inline": return f"<p>{label}: {value}</p>"
    return f"<table><thead><tr><th>{label}</th></tr></thead><tbody><tr><td>{value}</td></tr></tbody></table>"


def make_page(idx):
    p = person(); style = rnd.choice(VARIANTS); hard = idx % 5 == 0
    keys = rnd.sample(list(LABELS), rnd.randint(5, 9))
    sens = [{"value": p[k], "type": k} for k in keys]
    body, keep = [], []
    body.append(f"<h1>{rnd.choice(['Application Dashboard', 'Account Overview', 'Patient Portal', 'Service Centre'])}</h1>")
    rel = [{"type": "heading", "text": None}]
    if rnd.random() < 0.6:
        body.append(f"<p>Welcome back, {p['name']}</p>"); sens.append({"value": p["name"], "type": "name", "prose": True})
    order = keys + [rnd.choice(KEEP_FIELDS)[0] for _ in range(0)]
    for k in keys: body.append(render_field(style, LABELS[k], p[k], idx))
    for lab, val in rnd.sample(KEEP_FIELDS, 4):
        body.append(render_field(style, lab, val, idx)); keep.append(val)
    if rnd.random() < 0.5:
        body.append(f'<label for="i{idx}">Portal password</label><input id="i{idx}" type="password" value="Pw@{rnd.randint(100000, 999999)}x">')
        sens.append({"value": None, "type": "password_field"})
    body.append(f'<label for="s{idx}">Search services</label><input id="s{idx}" type="text" placeholder="e.g. certificate">')
    btns = rnd.sample(BUTTONS, 3); nav = rnd.sample(NAV, 3)
    body.append("<nav>" + "".join(f'<a href="#{n.lower().replace(" ", "")}">{n}</a> ' for n in nav) + "</nav>")
    body.append("".join(f'<button type="button">{b}</button>' for b in btns))
    body.append("<p>Card offers for you. Helpline: 1800-123-4567. Total due ₹1,25,000.00 by 2026-03-15.</p>")
    keep += ["Card offers for you", "1800-123-4567", "₹1,25,000.00", "2026-03-15"]
    if hard:
        h = rnd.choice(["nominee", "prose", "upi", "passport"])
        nm = f"{rnd.choice(FIRST)} {rnd.choice(LAST)}"
        if h == "nominee": body.append(f"<p>Nominee: {nm}</p>"); sens.append({"value": nm, "type": "name", "hard": h})
        elif h == "prose": body.append(f"<p>The applicant {nm} submitted the form last week.</p>"); sens.append({"value": nm, "type": "name", "hard": h})
        elif h == "upi": u = f"{nm.split()[0].lower()}@okbank"; body.append(f"<p>UPI: {u}</p>"); sens.append({"value": u, "type": "upi", "hard": h})
        else: pp = "K" + str(rnd.randint(1000000, 9999999)); body.append(f"<p>Passport: {pp}</p>"); sens.append({"value": pp, "type": "passport", "hard": h})
    relevant = [{"type": "button", "text": b} for b in btns] + [{"type": "link", "text": n} for n in nav]
    html = f"<!doctype html><html><head><meta charset=utf-8><title>Synthetic page {idx}</title></head><body>{''.join(body)}</body></html>"
    name = f"page_{idx:02d}.html"
    (ROOT / "pages" / name).write_text(html, encoding="utf-8")
    return {"page": name, "style": style, "sensitive": [s for s in sens if s["value"]], "keep": keep, "relevant": relevant}


def font(sz): return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", sz)


def make_image(idx):
    p = person(); sz = rnd.choice([24, 28, 32])
    fields = rnd.sample(["name", "email", "phone", "pan", "aadhaar", "card", "dob"], rnd.randint(3, 5))
    lines = [(f"{LABELS[k].replace('Debit Card Number', 'Card').replace('Mobile', 'Phone')}: {p[k]}", p[k], k) for k in fields]
    keeps = rnd.sample(["Issued by: Demo Authority", "Status: Verified", "Valid until 2030-12-31", "Scheme: Student Grant"], 2)
    W, H = 900, 60 + 56 * (len(lines) + len(keeps)) + 30
    im = Image.new("RGB", (W, H), (255, 255, 250)); d = ImageDraw.Draw(im)
    d.text((24, 12), "SYNTHETIC SAMPLE DOCUMENT", font=font(26), fill=(30, 30, 90)); y = 70
    order = [(l, v, k) for l, v, k in lines] + [(k, None, None) for k in keeps]; rnd.shuffle(order)
    for l, v, k in order: d.text((24, y), l, font=font(sz), fill=(10, 10, 10)); y += 56
    fn = f"img_{idx:02d}.png"; im.save(ROOT / "images" / fn)
    return {"image": fn, "pii": [{"value": v, "type": k} for _, v, k in lines], "keep_lines": keeps}


gt = {"pages": [make_page(i) for i in range(1, 41)], "images": [make_image(i) for i in range(1, 13)]}
(ROOT / "ground_truth.json").write_text(json.dumps(gt, indent=1, ensure_ascii=False), encoding="utf-8")
print(f"pages={len(gt['pages'])} images={len(gt['images'])} sensitive_values={sum(len(p['sensitive']) for p in gt['pages'])}")
