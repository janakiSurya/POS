/**
 * Generates the shop user guide PDF (non-technical).
 * Run: cd frontend && node scripts/generate-user-guide.mjs
 */
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { jsPDF } from "jspdf";

const __dir = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dir, "../../docs");
const outPath = join(outDir, "Sri-Sathya-Sai-POS-User-Guide.pdf");

const MARGIN = 16;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;

function buildGuide() {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = MARGIN;

  function footer() {
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text("Sri Sri Sathya Sai Automobiles — POS User Guide", MARGIN, PAGE_H - 10);
    doc.text(`Page ${doc.getNumberOfPages()}`, PAGE_W - MARGIN, PAGE_H - 10, { align: "right" });
    doc.setTextColor(0);
  }

  function newPage() {
    footer();
    doc.addPage();
    y = MARGIN;
  }

  function space(mm) {
    y += mm;
  }

  function need(h) {
    if (y + h > PAGE_H - 18) newPage();
  }

  function title(text) {
    need(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text(text, MARGIN, y);
    y += 9;
    doc.setFont("helvetica", "normal");
  }

  function heading(text) {
    need(12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(text, MARGIN, y);
    y += 7;
    doc.setFont("helvetica", "normal");
  }

  function sub(text) {
    need(10);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.text(text, MARGIN, y);
    y += 5.5;
    doc.setFont("helvetica", "normal");
  }

  function p(text) {
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(text, CONTENT_W);
    need(lines.length * 4.8 + 2);
    doc.text(lines, MARGIN, y);
    y += lines.length * 4.8 + 3;
  }

  function bullets(items) {
    doc.setFontSize(10);
    for (const item of items) {
      const lines = doc.splitTextToSize(item, CONTENT_W - 5);
      need(lines.length * 4.8);
      doc.text("•", MARGIN, y);
      doc.text(lines, MARGIN + 4, y);
      y += lines.length * 4.8;
    }
    space(2);
  }

  function tbl(head, rows) {
    const cols = head.length;
    const cw = CONTENT_W / cols;
    const rh = 6.5;
    need(rh * (rows.length + 2) + 4);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    let x = MARGIN;
    head.forEach((h) => {
      doc.text(h, x + 1, y + 4, { maxWidth: cw - 2 });
      x += cw;
    });
    y += rh;
    doc.setDrawColor(160);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    doc.setFont("helvetica", "normal");
    rows.forEach((row) => {
      x = MARGIN;
      row.forEach((cell) => {
        doc.text(String(cell), x + 1, y + 4, { maxWidth: cw - 2 });
        x += cw;
      });
      y += rh;
    });
    space(3);
  }

  // ——— Content ———
  title("Sri Sri Sathya Sai Automobiles");
  p("POS User Guide — for shop staff and owner. Written in simple language.");
  space(2);

  heading("1. What is this application?");
  p(
    "This is your shop billing software. You can search parts, make bills, take Cash or UPI payment, print receipts, track daily cash in the drawer, and see sales reports. It works on computer, tablet, or phone (install from browser if needed).",
  );

  heading("2. Login");
  tbl(
    ["Who", "Email", "Password", "What they can open"],
    [
      ["Owner (manager)", "owner@sathyasai.local", "123456*", "Everything"],
      ["Staff (counter)", "staff@sathyasai.local", "123456*", "POS and Bills only"],
    ],
  );
  p("* Change these passwords in production. Owner should keep the owner login private.");

  heading("3. Every working day — step by step");
  bullets([
    "Sign in.",
    "OPEN SHIFT — enter opening cash and opening UPI (see section 4).",
    "Bill customers on POS all day.",
    "Record cash expenses if money is taken from drawer (petrol, tea, etc.).",
    "At end of day: CLOSE SHIFT — count cash and UPI, download PDF summary.",
    "Sign out.",
  ]);
  p("You cannot bill on POS until the shift is open. Only one open shift per day.");

  heading("4. Opening cash and opening UPI — what do they mean?");
  p(
    "When you start the day, the app asks for two numbers. These are your STARTING balances before any sale today.",
  );
  sub("Opening cash (₹)");
  p(
    "Physical notes and coins in the cash drawer right now. Example: you counted ₹5,000 in the drawer at 9 AM — enter 5000.",
  );
  sub("Opening UPI (₹)");
  p(
    "Money already sitting in your UPI account (PhonePe / GPay / bank UPI) before sales today. Example: balance shows ₹2,000 — enter 2000. This is NOT today's UPI sales; it is what you had at opening.",
  );
  sub("Why both?");
  p(
    "At closing, the app calculates what cash and UPI SHOULD be (opening + sales − expenses). You then enter what you actually counted. If numbers match, your tally is correct.",
  );

  heading("5. POS — billing a customer");
  bullets([
    "Search box: type part name or code (e.g. ACTIVA filter). Click a result or press Enter.",
    "Quantity and discount: change qty; staff discount on each line max 20%. Owner can give more.",
    "Customer phone (optional): enter 10-digit mobile; name saved for credit customers.",
    "Payment: choose Cash, UPI, or Credit (customer pays later).",
    "Print & complete — prints bill and finishes sale.",
    "Complete (no bill) — finishes sale without printing.",
  ]);
  tbl(
    ["Button / field", "Meaning"],
    [
      ["Cash", "Customer paid with notes/coins"],
      ["UPI", "Customer paid via PhonePe/GPay/etc."],
      ["Credit", "Customer will pay later; needs phone number"],
      ["Line discount", "Discount % on one item"],
      ["Bill discount", "Discount % on whole bill (owner or allowed staff)"],
    ],
  );

  heading("6. Cash expense");
  p(
    "Top bar → Expense. Use when cash is taken OUT of the drawer (not for buying stock on credit). Enter amount and short note. This reduces expected cash at closing.",
  );

  heading("7. Close shift — end of day");
  p("Top bar → Close shift. Enter what you actually counted:");
  bullets([
    "Counted physical cash — notes/coins in drawer now.",
    "Actual UPI balance — check PhonePe/GPay/bank app total.",
  ]);
  sub("Expected cash");
  p("Opening cash + Cash sales today − Cash expenses today.");
  sub("Expected UPI");
  p("Opening UPI + UPI sales today.");
  sub("Variance");
  p(
    "Difference between counted and expected. Zero = perfect. Positive = extra money. Negative = short. Small differences can happen; investigate large ones.",
  );
  p(
    "After you submit, a PDF downloads automatically. It is also saved in the app (Dashboard → Saved end-of-day reports).",
  );

  heading("8. Bills page (Staff & Owner)");
  p("View past customer bills. Search by bill number or customer phone.");
  tbl(
    ["Filter", "Shows"],
    [
      ["Today", "Bills for today (India time)"],
      ["7 days", "Last 7 days"],
      ["All", "All saved bills"],
    ],
  );
  tbl(
    ["Column on list", "Meaning"],
    [
      ["Bill number", "e.g. SSA-0001"],
      ["Time / customer", "When sold; walk-in or customer name"],
      ["Amount", "Total bill value"],
      ["Payment", "CASH / UPI / CREDIT"],
    ],
  );
  p("Tap a bill to open details, download PDF/Excel, or reprint.");

  heading("9. Owner — Dashboard");
  tbl(
    ["Card / section", "Meaning"],
    [
      ["Stock cost value", "Total purchase cost of all stock"],
      ["Retail value", "Total if all stock sold at selling price"],
      ["Today revenue", "All sales today (cash + UPI + credit)"],
      ["Today gross profit", "Sales minus item cost (today)"],
      ["Cash / UPI / Credit today", "Breakdown by payment type"],
      ["Low stock", "Parts below minimum level"],
      ["Dead stock", "Parts in stock but never sold"],
      ["Saved end-of-day reports", "Past closing PDFs — Download again"],
      ["Register audit", "Past days: open cash, cash/UPI variance"],
    ],
  );

  heading("10. Owner — Reports page");
  p("Sales charts and comparisons. Use Refresh to update.");
  tbl(
    ["Section", "Meaning"],
    [
      ["Sales this month", "Total sales in current calendar month"],
      ["Expenses this month", "Cash taken from drawer this month"],
      ["Net this month", "Sales minus expenses this month"],
      ["Selected period", "Pick dates; see daily sales chart"],
      ["Payment mix", "How much was Cash vs UPI vs Credit"],
      ["Week / month comparison", "This period vs previous period"],
      ["Net profit chart", "Month over month after expenses"],
    ],
  );

  heading("11. Owner — Inventory");
  tbl(
    ["Column", "Meaning"],
    [
      ["Part no.", "Supplier code"],
      ["Name", "Part description"],
      ["Stock", "Quantity in shop now"],
      ["Cost", "Purchase price (owner only)"],
      ["Sell", "Price on bill"],
      ["Min alert", "Warn when stock falls below this"],
      ["Rack", "Shelf location"],
    ],
  );

  heading("12. Owner — Purchases & Excel import");
  p(
    "Purchases: enter supplier invoices manually. Excel import: bulk load Kumar / Gayatri / Kokila invoice files. Posted purchases increase stock.",
  );

  heading("13. Offline use");
  p(
    "If internet stops, you can still bill — sales save on the device and sync when internet returns. Header shows Offline. Open shift once while online so parts are loaded.",
  );

  heading("14. Quick daily checklist");
  tbl(
    ["Time", "Action"],
    [
      ["Morning", "Login → Open shift → enter opening cash & UPI"],
      ["During day", "POS billing; Expense if cash taken out"],
      ["Evening", "Close shift → count cash & UPI → save PDF"],
      ["Any time", "Bills page to find old receipts"],
    ],
  );

  heading("15. Help");
  p(
    "If bills or stock look wrong: tap Refresh on that page. If still wrong, contact the person who manages Supabase / owner account. Do not share owner login with staff.",
  );

  footer();
  return doc;
}

mkdirSync(outDir, { recursive: true });
const doc = buildGuide();
doc.save(outPath);
console.log("User guide written to:", outPath);
