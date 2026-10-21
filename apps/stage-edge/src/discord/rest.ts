import { cleanBotToken } from './protocol'

export const DISCORD_API_BASE = 'https://discord.com/api/v10'

export interface DiscordMessageResponse {
  id: string
  channel_id: string
  content: string
}

export async function sendDiscordMessage(
  token: string,
  channelId: string,
  content: string,
): Promise<DiscordMessageResponse> {
  const clean = cleanBotToken(token)
  const url = `${DISCORD_API_BASE}/channels/${channelId}/messages`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${clean}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Discord REST error [${response.status}] ${response.statusText}: ${errorBody}`)
  }

  return (await response.json()) as DiscordMessageResponse
}

export async function fetchCurrentBotUser(token: string): Promise<{
  id: string
  username: string
  discriminator: string
  bot: boolean
}> {
  const clean = cleanBotToken(token)
  const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: {
      Authorization: `Bot ${clean}`,
    },
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Failed to fetch Discord @me [${response.status}]: ${errorBody}`)
  }

  return await response.json()
}
