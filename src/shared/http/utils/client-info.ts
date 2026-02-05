import type { Request } from 'express'

export function getClientInfo(req: Request): {
	ip: string
	userAgent: string | null
} {
	const xff = req.headers['x-forwarded-for']
	const xri = req.headers['x-real-ip']

	if (typeof xri === 'string' && xri.trim()) {
		return { ip: xri.trim(), userAgent: req.headers['user-agent'] ?? null }
	}

	if (typeof xff === 'string' && xff.trim()) {
		return {
			ip: xff.split(',')[0]?.trim() ?? xff.trim(),
			userAgent: req.headers['user-agent'] ?? null
		}
	}

	if (Array.isArray(xff) && xff.length > 0) {
		return {
			ip: xff[0]?.split(',')[0]?.trim() ?? xff[0] ?? '',
			userAgent: req.headers['user-agent'] ?? null
		}
	}

	return {
		ip: req.ip ?? req.socket?.remoteAddress ?? '',
		userAgent: req.headers['user-agent'] ?? null
	}
}
