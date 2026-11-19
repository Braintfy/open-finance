#!/usr/bin/env bash
# PURPOSE: Разовый перенос данных дев-БД Open Finance на прод (Raspberry Pi 5).
#
# Identity-строки (tenants/users/memberships/workspaces) НЕ копируются — на проде
# свои, с рабочим паролем. Вместо этого в потоке данных заменяются три UUID:
# tenant, user и workspace. Замена текстовая: эти UUID уникальны и встречаются
# только в своих ролях, поэтому подмена безопасна и не заденет чужие ключи.
# Остальные UUID (товары, заказы, доски, аккаунт маркетплейса) сохраняются —
# иначе развалятся внешние ссылки между таблицами.

set -uo pipefail

# UUID задаются через окружение (реальные значения в репозитории не хранятся).
DEV_TENANT="${DEV_TENANT:?set DEV_TENANT}";  PROD_TENANT="${PROD_TENANT:?set PROD_TENANT}"
DEV_USER="${DEV_USER:?set DEV_USER}";        PROD_USER="${PROD_USER:?set PROD_USER}"
DEV_WS="${DEV_WS:?set DEV_WS}";              PROD_WS="${PROD_WS:?set PROD_WS}"

PI='firay@192.168.31.222'
KEY="$HOME/.ssh/openfinance_pi"

dev()  { docker exec -i openfinance-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -tA'; }
prod() { ssh -i "$KEY" "$PI" 'docker exec -i openfinance-postgres sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -v ON_ERROR_STOP=1 -tA"'; }

# Порядок важен: сначала то, на что ссылаются внешние ключи.
TABLES="marketplace_accounts unit_products ozon_clusters ozon_warehouse_stocks
        ozon_orders ozon_transactions ozon_analytics_daily
        ozon_perf_campaigns ozon_perf_sku_stats ozon_perf_cpo_daily ozon_perf_expense_daily
        ozon_sync_jobs ozon_ai_insight_reports
        boards block_layouts transactions
        inbox_channels inbox_messages currency_rates
        section_ai_reports block_ai_reports unit_imports"

echo "=== Подготовка: убираю конфликтующую строку на проде ==="
echo "DELETE FROM block_layouts WHERE page_key='marketplaces-ozon-dashboard';" | prod && echo "  дефолтная раскладка Ozon-дашборда удалена (приедет из дева)"
echo

FAILED=""
for T in $TABLES; do
  N=$(printf "SELECT count(*) FROM %s;" "$T" | dev | tr -d ' \r')
  if [ "${N:-0}" = "0" ]; then printf "  · %-24s пусто\n" "$T"; continue; fi

  COLS=$(printf "SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='%s';" "$T" | dev | tr -d '\r')

  printf "  → %-24s %6s строк ... " "$T" "$N"

  if printf "COPY %s TO STDOUT;" "$T" | dev \
     | sed -e "s/$DEV_TENANT/$PROD_TENANT/g" -e "s/$DEV_USER/$PROD_USER/g" -e "s/$DEV_WS/$PROD_WS/g" \
     | ssh -i "$KEY" "$PI" "docker exec -i openfinance-postgres sh -c 'psql -U \$POSTGRES_USER -d \$POSTGRES_DB -v ON_ERROR_STOP=1 -c \"COPY $T ($COLS) FROM STDIN\"'" >/tmp/t_out 2>/tmp/t_err
  then
    GOT=$(printf "SELECT count(*) FROM %s;" "$T" | prod | tr -d ' \r')
    if [ "$GOT" = "$N" ]; then echo "ок ($GOT)"; else echo "ЧАСТИЧНО: дев $N → прод $GOT"; FAILED="$FAILED $T"; fi
  else
    echo "ОШИБКА"; head -2 /tmp/t_err | sed 's/^/      /'; FAILED="$FAILED $T"
  fi
done

echo
if [ -n "$FAILED" ]; then echo "⚠ проблемные таблицы:$FAILED"; else echo "✓ все таблицы перенесены полностью"; fi
