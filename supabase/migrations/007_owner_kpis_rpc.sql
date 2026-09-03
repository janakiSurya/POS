-- Owner dashboard + reports aggregations (server-side for speed)

CREATE OR REPLACE FUNCTION public.owner_dashboard_kpis()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  today_ist date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'stockCost', COALESCE((SELECT SUM(purchase_price * stock_quantity) FROM products), 0),
    'retailValue', COALESCE((SELECT SUM(selling_price * stock_quantity) FROM products), 0),
    'productCount', COALESCE((SELECT COUNT(*) FROM products), 0),
    'todayCash', COALESCE((SELECT SUM(total_amount) FROM invoices WHERE payment_method = 'CASH' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = today_ist), 0),
    'todayUpi', COALESCE((SELECT SUM(total_amount) FROM invoices WHERE payment_method = 'UPI' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = today_ist), 0),
    'todayCredit', COALESCE((SELECT SUM(total_amount) FROM invoices WHERE payment_method = 'CREDIT' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = today_ist), 0),
    'grossProfit', COALESCE((
      SELECT SUM(ii.line_total - ii.unit_cost * ii.quantity)
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE (i.created_at AT TIME ZONE 'Asia/Kolkata')::date = today_ist
    ), 0),
    'lowStock', COALESCE((
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT id, name, part_number, stock_quantity, min_stock_alert
        FROM products
        WHERE stock_quantity <= min_stock_alert
        ORDER BY stock_quantity ASC
        LIMIT 10
      ) t
    ), '[]'::jsonb),
    'deadStock', COALESCE((
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT p.id, p.name, p.part_number
        FROM products p
        WHERE p.stock_quantity > 0
          AND NOT EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.product_id = p.id)
        ORDER BY p.name
        LIMIT 10
      ) t
    ), '[]'::jsonb)
  ) INTO result;

  result := result || jsonb_build_object(
    'todayRevenue',
    COALESCE((result->>'todayCash')::numeric, 0)
      + COALESCE((result->>'todayUpi')::numeric, 0)
      + COALESCE((result->>'todayCredit')::numeric, 0)
  );

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_report_bundle(p_start date, p_end date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  month_start date := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
  today_ist date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  prev_month_start date := (date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')) - interval '1 month')::date;
  prev_month_end date := (date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')) - interval '1 day')::date;
BEGIN
  SELECT jsonb_build_object(
    'rangeSales', jsonb_build_object(
      'revenue', COALESCE((SELECT SUM(total_amount) FROM invoices WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_start AND p_end), 0),
      'count', COALESCE((SELECT COUNT(*) FROM invoices WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_start AND p_end), 0),
      'cash', COALESCE((SELECT SUM(total_amount) FROM invoices WHERE payment_method = 'CASH' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_start AND p_end), 0),
      'upi', COALESCE((SELECT SUM(total_amount) FROM invoices WHERE payment_method = 'UPI' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_start AND p_end), 0),
      'credit', COALESCE((SELECT SUM(total_amount) FROM invoices WHERE payment_method = 'CREDIT' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_start AND p_end), 0)
    ),
    'rangeExpenses', COALESCE((SELECT SUM(amount) FROM cash_expenses WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_start AND p_end), 0),
    'rangeExpenseCount', COALESCE((SELECT COUNT(*) FROM cash_expenses WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_start AND p_end), 0),
    'rangeCogs', COALESCE((
      SELECT SUM(ii.unit_cost * ii.quantity)
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE (i.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_start AND p_end
    ), 0),
    'rangeFixed', COALESCE((
      SELECT SUM(amount) FROM fixed_cost_logs
      WHERE month >= to_char(p_start, 'YYYY-MM') AND month <= to_char(p_end, 'YYYY-MM')
    ), 0),
    'dailySales', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', d::text,
        'label', to_char(d, 'MM/DD'),
        'sales', COALESCE(s.amt, 0)
      ) ORDER BY d)
      FROM generate_series(p_start, p_end, '1 day'::interval) AS g(d)
      LEFT JOIN (
        SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day, SUM(total_amount) AS amt
        FROM invoices
        WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_start AND p_end
        GROUP BY 1
      ) s ON s.day = d::date
    ), '[]'::jsonb),
    'dailyExpenses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', d::text,
        'label', to_char(d, 'MM/DD'),
        'expenses', COALESCE(e.amt, 0)
      ) ORDER BY d)
      FROM generate_series(p_start, p_end, '1 day'::interval) AS g(d)
      LEFT JOIN (
        SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day, SUM(amount) AS amt
        FROM cash_expenses
        WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_start AND p_end
        GROUP BY 1
      ) e ON e.day = d::date
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.owner_dashboard_kpis() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_report_bundle(date, date) TO authenticated;
