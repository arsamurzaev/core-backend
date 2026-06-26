import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import nodemailer, { type Transporter } from 'nodemailer'

import type { EmailSenderPort, SendEmailInput } from './contracts'

@Injectable()
export class EmailService implements EmailSenderPort {
	private readonly logger = new Logger(EmailService.name)
	private readonly driver = (
		process.env.EMAIL_DRIVER ??
		(process.env.NODE_ENV === 'production' ? 'smtp' : 'log')
	).toLowerCase()
	private transporter: Transporter | null = null

	async send(input: SendEmailInput): Promise<void> {
		if (this.driver === 'smtp') {
			await this.sendSmtp(input)
			return
		}

		this.logger.log({
			event: 'email_log',
			to: input.to,
			subject: input.subject,
			text: input.text ?? null,
			html: input.html,
			attachments:
				input.attachments?.map(attachment => ({
					filename: attachment.filename,
					contentType: attachment.contentType ?? null,
					size: Buffer.isBuffer(attachment.content)
						? attachment.content.length
						: Buffer.byteLength(attachment.content)
				})) ?? []
		} as any)
	}

	private async sendSmtp(input: SendEmailInput): Promise<void> {
		const transporter = this.getSmtpTransporter()
		const from =
			process.env.EMAIL_FROM ??
			process.env.SMTP_FROM ??
			process.env.SMTP_USER ??
			''

		if (!from) {
			throw new ServiceUnavailableException('Email sender is not configured')
		}

		await transporter.sendMail({
			from,
			to: input.to,
			subject: input.subject,
			html: input.html,
			text: input.text,
			attachments: input.attachments
		})
	}

	private getSmtpTransporter(): Transporter {
		if (this.transporter) return this.transporter

		const host = process.env.SMTP_HOST
		const port = Number(process.env.SMTP_PORT ?? 587)
		if (!host || !Number.isInteger(port)) {
			throw new ServiceUnavailableException('SMTP is not configured')
		}

		const user = process.env.SMTP_USER
		const pass = process.env.SMTP_PASSWORD

		this.transporter = nodemailer.createTransport({
			host,
			port,
			secure: process.env.SMTP_SECURE === 'true' || port === 465,
			...(user && pass ? { auth: { user, pass } } : {})
		})

		return this.transporter
	}
}
