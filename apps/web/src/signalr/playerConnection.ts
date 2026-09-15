import * as signalR from '@microsoft/signalr'

export interface PlayerCommand {
  protocolVersion: number
  commandId: string
  type: string
  issuedAt: string
  payload?: Record<string, unknown>
}

export function createPlayerConnection(deviceToken: string, onCommand: (command: PlayerCommand) => void) {
  const connection = new signalR.HubConnectionBuilder()
    .withUrl(`/hubs/player?deviceToken=${encodeURIComponent(deviceToken)}`)
    .withAutomaticReconnect()
    .build()

  connection.on('command', onCommand)
  return connection
}
