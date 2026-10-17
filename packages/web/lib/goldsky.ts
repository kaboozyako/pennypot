// Нова версія URL 1.0.2
const GOLDSKY_URL = "https://api.goldsky.com/api/public/project_cmvckgzctt7nu01ztb3mpc7mo/subgraphs/pennypot/1.0.2/gn";

// Функція для верхньої статистики
export async function fetchUserPositions(userAddress: string) {
  const query = `
    query GetUserPosition($id: ID!) {
      userPosition(id: $id) {
        totalTicketsBought
        totalShares
        totalClaimed
      }
    }
  `;

  try {
    const response = await fetch(GOLDSKY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { id: userAddress.toLowerCase() },
      }),
    });

    const { data } = await response.json();
    return data?.userPosition || null;
  } catch (error) {
    console.error("Goldsky error:", error);
    return null;
  }
}

// === НОВА ФУНКЦІЯ: З лімітом 1000 замість стандартних 100 ===
export async function fetchUserTicketHistory(userAddress: string) {
  const query = `
    query GetUserTickets($user: String!) {
      ticketPurchases(where: { user: $user }, orderBy: block, orderDirection: desc, first: 1000) {
        ticketId
        shares
        block
      }
    }
  `;

  try {
    const response = await fetch(GOLDSKY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { user: userAddress.toLowerCase() },
      }),
    });
    
    const { data } = await response.json();
    return data?.ticketPurchases || [];
  } catch (error) {
    console.error("Goldsky history error:", error);
    return [];
  }
}