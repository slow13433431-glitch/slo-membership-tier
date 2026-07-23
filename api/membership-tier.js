const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP; // e.g. s-l-o.myshopify.com
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SECRET_TOKEN = process.env.SECRET_TOKEN;

const TIER_THRESHOLDS = {
  LODE: 15000,
  ORE: 6000,
};

export default async function handler(req, res) {
  // 驗證 secret token
  if (req.headers['x-secret-token'] !== SECRET_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { customer_id } = req.body;
  if (!customer_id) {
    return res.status(400).json({ error: 'Missing customer_id' });
  }

  try {
    // 計算 365 天前的日期
    const since = new Date();
    since.setDate(since.getDate() - 365);
    const sinceISO = since.toISOString();

    // 查詢過去 365 天的訂單
    let totalSpent = 0;
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      const query = `
        query ($customerId: ID!, $after: String) {
          customer(id: $customerId) {
            orders(first: 50, after: $after, query: "created_at:>${sinceISO} financial_status:paid") {
              edges {
                node {
                  totalPriceSet {
                    shopMoney { amount }
                  }
                  refunds {
                    totalRefundedSet {
                      shopMoney { amount }
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `;

      const response = await fetch(
        `https://${SHOPIFY_SHOP}/admin/api/2026-04/graphql.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_TOKEN,
          },
          body: JSON.stringify({
            query,
            variables: {
              customerId: `gid://shopify/Customer/${customer_id}`,
              after: cursor,
            },
          }),
        }
      );

      const data = await response.json();
      const orders = data.data.customer.orders;

      for (const { node } of orders.edges) {
        const orderAmount = parseFloat(node.totalPriceSet.shopMoney.amount);
        const refundAmount = node.refunds.reduce((sum, r) =>
          sum + parseFloat(r.totalRefundedSet.shopMoney.amount), 0
        );
        totalSpent += orderAmount - refundAmount;
      }

      hasNextPage = orders.pageInfo.hasNextPage;
      cursor = orders.pageInfo.endCursor;
    }

    // 判斷等級
    let tier = 'RAW';
    if (totalSpent >= TIER_THRESHOLDS.LODE) tier = 'LODE';
    else if (totalSpent >= TIER_THRESHOLDS.ORE) tier = 'ORE';

    return res.status(200).json({ tier, total_spent: totalSpent });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
