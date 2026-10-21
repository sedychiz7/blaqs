export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface Notifier {
  push(pushToken: string, message: PushMessage): Promise<void>;
}

export class ConsoleNotifier implements Notifier {
  async push(pushToken: string, message: PushMessage) {
    console.log(`[push → ${pushToken.slice(0, 18)}…] ${message.title}: ${message.body}`);
  }
}

export class ExpoPushNotifier implements Notifier {
  constructor(private accessToken?: string) {}

  async push(pushToken: string, message: PushMessage) {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify({ to: pushToken, sound: 'default', priority: 'high', ...message }),
    });
    if (!res.ok) console.warn(`Expo push failed: ${res.status} ${await res.text()}`);
  }
}

export class MemoryNotifier implements Notifier {
  sent: { pushToken: string; message: PushMessage }[] = [];
  async push(pushToken: string, message: PushMessage) {
    this.sent.push({ pushToken, message });
  }
}
