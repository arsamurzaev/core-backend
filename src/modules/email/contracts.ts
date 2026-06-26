export const EMAIL_SENDER_PORT = Symbol('EMAIL_SENDER_PORT')

export type EmailAttachment = {
	filename: string
	content: Buffer | string
	contentType?: string
}

export type SendEmailInput = {
	to: string
	subject: string
	html: string
	text?: string
	attachments?: EmailAttachment[]
}

export interface EmailSenderPort {
	send(input: SendEmailInput): Promise<void>
}
