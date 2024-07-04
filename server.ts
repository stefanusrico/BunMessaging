import type { ServerWebSocket } from "bun"

type ChatData = {
  userId: string
  username: string
}

const activeConnections: Record<string, ServerWebSocket<ChatData>> = {}
const groups: Record<string, Set<string>> = { general: new Set() }

const server = Bun.serve<ChatData>({
  fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === "/chat") {
      const { userId, username } = getUserInfoFromReq(req)
      const success = server.upgrade(req, { data: { userId, username } })
      return success
        ? undefined
        : new Response("WebSocket upgrade error", { status: 400 })
    }
    return new Response("Hello world")
  },
  websocket: {
    open(ws) {
      const { userId, username } = ws.data
      activeConnections[userId] = ws
      groups["general"].add(userId)
      ws.subscribe("general")
      server.publish(
        "general",
        JSON.stringify({
          type: "system",
          content: `${username} has joined the general chat`,
        })
      )
      ws.send(
        JSON.stringify({
          type: "system",
          content: `Welcome, ${username}! You've been added to the general chat.`,
        })
      )
      sendUserList()
      sendGroupList(ws)
      notifyUserJoined(userId, username)
    },
    message(ws, message) {
      const { userId, username } = ws.data
      const data = JSON.parse(message.toString())

      switch (data.type) {
        case "group":
          if (groups[data.group]?.has(userId)) {
            server.publish(
              data.group,
              JSON.stringify({
                type: "group",
                group: data.group,
                from: username,
                content: data.content,
              })
            )
          } else {
            ws.send(
              JSON.stringify({
                type: "error",
                content: `You are not a member of the group ${data.group}`,
              })
            )
          }
          break
        case "individual":
          const targetWs = activeConnections[data.targetId]
          if (targetWs) {
            targetWs.send(
              JSON.stringify({
                type: "individual",
                from: username,
                fromId: userId,
                content: data.content,
              })
            )
          } else {
            ws.send(
              JSON.stringify({
                type: "error",
                content: "User not found or offline",
              })
            )
          }
          break
        case "createGroup":
          if (!groups[data.group]) {
            groups[data.group] = new Set([userId])
            ws.subscribe(data.group)
            ws.send(
              JSON.stringify({
                type: "system",
                content: `You've created and joined the group ${data.group}`,
              })
            )
            sendGroupList()
          } else {
            ws.send(
              JSON.stringify({
                type: "error",
                content: `Group ${data.group} already exists`,
              })
            )
          }
          break
        case "joinGroup":
          if (groups[data.group]) {
            groups[data.group].add(userId)
            ws.subscribe(data.group)
            server.publish(
              data.group,
              JSON.stringify({
                type: "system",
                content: `${username} has joined the group`,
              })
            )
            ws.send(
              JSON.stringify({
                type: "system",
                content: `You've joined the group ${data.group}`,
              })
            )
            notifyGroupMembershipChanged()
          } else {
            ws.send(
              JSON.stringify({
                type: "error",
                content: `Group ${data.group} does not exist`,
              })
            )
          }
          break
      }
    },
    close(ws) {
      const { userId, username } = ws.data
      delete activeConnections[userId]
      for (const group in groups) {
        if (groups[group].has(userId)) {
          groups[group].delete(userId)
          server.publish(
            group,
            JSON.stringify({
              type: "system",
              content: `${username} has left the chat`,
            })
          )
        }
      }
      ws.unsubscribe("general")
      notifyUserLeft(userId, username)
      notifyGroupMembershipChanged()
    },
  },
})

console.log(`Listening on ${server.hostname}:${server.port}`)

function getUserInfoFromReq(req: Request): {
  userId: string
  username: string
} {
  // In a real application, you would extract this info from cookies or headers
  const userId = "user_" + Math.floor(Math.random() * 1000)
  const username = "User" + userId.split("_")[1]
  return { userId, username }
}

function sendUserList() {
  const userList = Object.values(activeConnections).map((conn) => ({
    userId: conn.data.userId,
    username: conn.data.username,
  }))
  const message = JSON.stringify({
    type: "userList",
    users: userList,
  })
  Object.values(activeConnections).forEach((ws) => ws.send(message))
}

function sendGroupList(ws?: ServerWebSocket<ChatData>) {
  const groupList = Object.keys(groups).map((groupName) => ({
    name: groupName,
    members: Array.from(groups[groupName]),
  }))
  const message = JSON.stringify({
    type: "groupList",
    groups: groupList,
  })
  if (ws) {
    ws.send(message)
  } else {
    Object.values(activeConnections).forEach((ws) => ws.send(message))
  }
}

function notifyUserJoined(userId: string, username: string) {
  const message = JSON.stringify({
    type: "userJoined",
    userId,
    username,
  })
  Object.values(activeConnections).forEach((ws) => ws.send(message))
}

function notifyUserLeft(userId: string, username: string) {
  const message = JSON.stringify({
    type: "userLeft",
    userId,
    username,
  })
  Object.values(activeConnections).forEach((ws) => ws.send(message))
}

function notifyGroupMembershipChanged() {
  sendGroupList()
}
