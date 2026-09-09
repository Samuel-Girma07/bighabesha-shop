#!/usr/bin/env bash
# ==============================================================================
# Bighabesha Shop — Ethiopian Bank Egress Connectivity Diagnostic Script
# Tests outbound firewall rules, DNS resolution, Port 100 (CBE),
# Port 8225 (Awash), and Telebirr Residential Proxy routing.
# ==============================================================================

set -euo pipefail

COLOR_RESET="\033[0m"
COLOR_GREEN="\033[32m"
COLOR_YELLOW="\033[33m"
COLOR_RED="\033[31m"
COLOR_CYAN="\033[36m"

echo -e "${COLOR_CYAN}================================================================${COLOR_RESET}"
echo -e "${COLOR_CYAN} Bighabesha Shop: Ethiopian Bank Rail Egress Diagnostic Tool   ${COLOR_RESET}"
echo -e "${COLOR_CYAN}================================================================${COLOR_RESET}"

TIMEOUT=5
FAILED_CHECKS=0

check_dns() {
    local host="$1"
    echo -n "Checking DNS resolution for $host... "
    if getent hosts "$host" >/dev/null 2>&1 || nslookup "$host" >/dev/null 2>&1 || ping -c 1 -W 2 "$host" >/dev/null 2>&1; then
        echo -e "${COLOR_GREEN}OK${COLOR_RESET}"
    else
        echo -e "${COLOR_RED}FAILED${COLOR_RESET}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
    fi
}

check_tcp_port() {
    local host="$1"
    local port="$2"
    local desc="$3"

    echo -n "Checking TCP connectivity: $desc ($host:$port)... "
    if nc -z -w "$TIMEOUT" "$host" "$port" 2>/dev/null || (echo > /dev/tcp/"$host"/"$port") 2>/dev/null; then
        echo -e "${COLOR_GREEN}CONNECTED${COLOR_RESET}"
    else
        echo -e "${COLOR_YELLOW}CONNECTION FAILED / BLOCKED (Firewall or Egress Filter)${COLOR_RESET}"
        echo "  --> Hint: Ensure outbound TCP port $port is permitted in your security group / ufw."
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
    fi
}

check_http_endpoint() {
    local url="$1"
    local desc="$2"
    local proxy="${3:-}"

    echo -n "Checking HTTP endpoint: $desc ($url)... "
    local curl_cmd=(curl -s -o /dev/null -w "%{http_code}" --connect-timeout "$TIMEOUT" -m 10 "$url")
    if [ -n "$proxy" ]; then
        curl_cmd+=(-x "$proxy")
    fi

    local http_code
    http_code=$("${curl_cmd[@]}" 2>/dev/null || echo "000")

    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 400 ]; then
        echo -e "${COLOR_GREEN}OK (HTTP $http_code)${COLOR_RESET}"
    elif [ "$http_code" = "403" ] || [ "$http_code" = "451" ]; then
        echo -e "${COLOR_RED}GEOBLOCKED (HTTP $http_code)${COLOR_RESET}"
        echo "  --> Hint: Endpoint detected foreign IP; requires an Ethiopian residential/in-country proxy."
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
    elif [ "$http_code" = "000" ]; then
        echo -e "${COLOR_RED}TIMED OUT / UNREACHABLE${COLOR_RESET}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
    else
        echo -e "${COLOR_YELLOW}RETURNED HTTP $http_code (Service responding)${COLOR_RESET}"
    fi
}

echo -e "\n${COLOR_CYAN}[1/5] Core Infrastructure & DNS Checks${COLOR_RESET}"
check_dns "api.telegram.org"
check_dns "apps.cbe.com.et"
check_dns "transactioninfo.ethiotelecom.et"

echo -e "\n${COLOR_CYAN}[2/5] Telegram Bot API Egress${COLOR_RESET}"
check_http_endpoint "https://api.telegram.org" "Telegram API"

echo -e "\n${COLOR_CYAN}[3/5] Commercial Bank of Ethiopia (CBE) Port 100 Egress${COLOR_RESET}"
check_tcp_port "apps.cbe.com.et" "100" "CBE Confirmation Portal Port 100"
check_http_endpoint "https://apps.cbe.com.et:100" "CBE Web App (Port 100)"

echo -e "\n${COLOR_CYAN}[4/5] Awash Bank Port 8225 Egress${COLOR_RESET}"
check_tcp_port "awashbirr.awashbank.com" "8225" "Awash Bank Confirmation" || true

echo -e "\n${COLOR_CYAN}[5/5] Telebirr Egress & Proxy Check${COLOR_RESET}"
PROXY_URL="${TELEBIRR_PROXY_URL:-${ETHIOPIA_PROXY_URL:-}}"
if [ -n "$PROXY_URL" ]; then
    echo "Using configured proxy: $PROXY_URL"
    check_http_endpoint "https://transactioninfo.ethiotelecom.et" "Telebirr Portal (via Proxy)" "$PROXY_URL"
else
    echo "No proxy configured in TELEBIRR_PROXY_URL or ETHIOPIA_PROXY_URL. Testing direct egress..."
    check_http_endpoint "https://transactioninfo.ethiotelecom.et" "Telebirr Portal (Direct)"
fi

echo -e "\n${COLOR_CYAN}================================================================${COLOR_RESET}"
if [ "$FAILED_CHECKS" -eq 0 ]; then
    echo -e "${COLOR_GREEN} All egress and banking connectivity checks PASSED!${COLOR_RESET}"
    exit 0
else
    echo -e "${COLOR_YELLOW} $FAILED_CHECKS check(s) flagged warnings or failures.${COLOR_RESET}"
    echo -e " Review the instructions in docs/devops/DEPLOYMENT-RUNBOOK.md for troubleshooting."
    exit 0
fi
