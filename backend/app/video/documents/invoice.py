"""The GST tax invoice and credit note — rendered once from the frozen snapshot and stored.

Pay's rule: a document is built from the record AND its master data, so re-rendering a
March invoice in September would reprint it with September's address. The snapshot on
`tax_invoices` is what prints, and the PDF is stored with its checksum.
"""

from __future__ import annotations

from app.video.documents.page import Column, Document, Party, amount_in_words, money
from app.video.models.tax import TaxInvoice


KEYS = ("Credit note", "Export invoice", "Tax invoice", "Invoice", "Number", "Date", "Place of supply", "Order",
        "Billed to", "Item", "Taxable", "Tax", "Amount", "Taxable value", "Total", "The seller is not registered for GST; no tax is charged.")
LABELS = {
    "hi": ("क्रेडिट नोट", "निर्यात बीजक", "कर बीजक", "बीजक", "संख्या", "दिनांक", "आपूर्ति का स्थान", "ऑर्डर",
           "प्राप्तकर्ता", "विवरण", "कर योग्य", "कर", "राशि", "कर योग्य मूल्य", "कुल राशि",
           "विक्रेता GST में पंजीकृत नहीं है; कोई टैक्स नहीं लिया गया है।"),
    "mr": ("क्रेडिट नोट", "निर्यात बीजक", "कर बीजक", "बीजक", "क्रमांक", "दिनांक", "पुरवठ्याचे ठिकाण", "ऑर्डर",
           "ग्राहक", "तपशील", "करपात्र", "कर", "रक्कम", "करपात्र मूल्य", "एकूण रक्कम",
           "विक्रेता GST अंतर्गत नोंदणीकृत नाही; कोणताही कर आकारलेला नाही."),
    "bn": ("ক্রেডিট নোট", "রপ্তানি চালান", "কর চালান", "চালান", "নম্বর", "তারিখ", "সরবরাহের স্থান", "অর্ডার",
           "ক্রেতা", "বিবরণ", "করযোগ্য", "কর", "পরিমাণ", "করযোগ্য মূল্য", "মোট পরিমাণ",
           "বিক্রেতা GST-তে নিবন্ধিত নন; কোনো কর নেওয়া হয়নি।"),
    "ta": ("வரவுக் குறிப்பு", "ஏற்றுமதி விலைப்பட்டியல்", "வரி விலைப்பட்டியல்", "விலைப்பட்டியல்", "எண்", "தேதி",
           "வழங்கல் இடம்", "ஆர்டர்", "வாங்குபவர்", "விவரம்", "வரிக்குரியது", "வரி", "தொகை", "வரிக்குரிய மதிப்பு",
           "மொத்தத் தொகை", "விற்பனையாளர் GST-யில் பதிவு செய்யவில்லை; வரி எதுவும் வசூலிக்கப்படவில்லை."),
    "te": ("క్రెడిట్ నోట్", "ఎగుమతి ఇన్‌వాయిస్", "పన్ను ఇన్‌వాయిస్", "ఇన్‌వాయిస్", "సంఖ్య", "తేదీ", "సరఫరా స్థలం", "ఆర్డర్",
           "కొనుగోలుదారు", "వివరాలు", "పన్ను విధించదగినది", "పన్ను", "మొత్తం", "పన్ను విధించదగిన విలువ", "మొత్తం విలువ",
           "విక్రేత GSTలో నమోదు కాలేదు; ఎలాంటి పన్ను వసూలు చేయలేదు."),
}
WORDS = {lang: dict(zip(KEYS, words, strict=True)) for lang, words in LABELS.items()}


def render(inv: TaxInvoice) -> bytes:
    seller = inv.seller or {}
    buyer = inv.buyer or {}
    local = WORDS.get(buyer.get("language") or "")
    bilingual = local is not None

    def t(en: str) -> str:
        return f"{en} / {local[en]}" if bilingual and en in local else en

    registered = bool(seller.get("gstin"))
    label = ("Credit note" if inv.kind == "credit_note" else "Export invoice" if inv.kind == "export"
             else ("Tax invoice" if registered else "Invoice"))
    pdf = Document(title=f"{label} {inv.number}", footer_note=f"{seller.get('name', '')} · {inv.number}")
    pdf.add_page()
    supplier = Party(
        name=seller.get("name") or "Seller",
        lines=[x for x in [seller.get("address"), seller.get("email")] if x],
        registration=seller.get("gstin"),
    )
    fields = [(t("Number"), inv.number), (t("Date"), inv.invoice_date.isoformat())]
    if inv.place_of_supply:
        fields.append((t("Place of supply"), inv.place_of_supply))
    if seller.get("order_number"):
        fields.append((t("Order"), seller["order_number"]))
    doc_label = f"{label.upper()} / {local[label]}" if bilingual else label.upper()
    pdf.masthead(supplier=supplier, doc_label=doc_label, fields=fields, split=0.5 if bilingual else 0.6)
    pdf.party_block([(t("Billed to"), Party(
        name=buyer.get("name") or buyer.get("email") or "Customer",
        lines=[x for x in [buyer.get("email"), buyer.get("phone")] if x],
        registration=buyer.get("gstin"),
    ))])
    cols = [
        Column("title", "Item", 76), Column("sac", "SAC", 18), Column("taxable", "Taxable", 26, "R"),
        Column("rate", "GST", 14, "R"), Column("tax", "Tax", 22, "R"), Column("total", "Amount", 26, "R"),
    ]
    rows = []
    for l in inv.lines:
        rows.append({
            "title": l.get("title", ""), "sac": l.get("sac") or "",
            "taxable": money(l.get("taxable_minor", 0), inv.currency),
            "rate": f"{l.get('tax_rate_bps', 0) / 100:g}%",
            "tax": money(l.get("tax_minor", 0), inv.currency),
            "total": money(l.get("total_minor", 0), inv.currency),
        })
    sub = {c.key: local[c.header] for c in cols if c.header in local} if bilingual else None
    pdf.grid(cols, rows, sub_headers=sub)
    totals = [(t("Taxable value"), money(inv.taxable_minor, inv.currency))]
    if inv.cgst_minor:
        totals.append(("CGST", money(inv.cgst_minor, inv.currency)))
        totals.append(("SGST", money(inv.sgst_minor, inv.currency)))
    if inv.igst_minor:
        totals.append(("IGST", money(inv.igst_minor, inv.currency)))
    totals.append((t("Total"), money(inv.total_minor, inv.currency)))
    pdf.totals(totals, emphasis=t("Total"))
    pdf.note_line(amount_in_words(inv.total_minor, inv.currency))
    if not registered and inv.kind != "export":
        pdf.note_line("The seller is not registered for GST; no tax is charged.")
        if bilingual:
            pdf.note_line(local["The seller is not registered for GST; no tax is charged."])
    if seller.get("note"):
        pdf.note_line(seller["note"])
    return pdf.output_bytes()
