import { BadGatewayException } from '@nestjs/common'
import axios from 'axios'

import { fileTo34 } from './file-to-34'

export async function loadImage(url: string, token: string) {
	try {
		const res = await axios.get(url, {
			responseType: 'arraybuffer',
			headers: {
				Authorization: `Bearer ${token}`
			}
		})

		const base64 = (await fileTo34(Buffer.from(res.data, 'binary'))).toString(
			'base64'
		)
		const mime = res.headers['content-type']

		return `data:${mime};base64,${base64}`
	} catch (error) {
		throw new BadGatewayException(error)
	}
}
