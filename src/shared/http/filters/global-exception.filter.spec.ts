import { ArgumentsHost, NotFoundException } from '@nestjs/common'

import { GlobalExceptionFilter } from './global-exception.filter'

function createHost(path: string, response: Record<string, jest.Mock>) {
	return {
		switchToHttp: () => ({
			getRequest: () => ({
				method: 'GET',
				originalUrl: path,
				url: path
			}),
			getResponse: () => response
		})
	} as ArgumentsHost
}

describe('GlobalExceptionFilter', () => {
	it('marks public cart not found responses to clear stored keys', () => {
		const filter = new GlobalExceptionFilter()
		const response = {
			setHeader: jest.fn(),
			status: jest.fn().mockReturnThis(),
			json: jest.fn()
		}

		filter.catch(
			new NotFoundException('Корзина не найдена'),
			createHost('/cart/public/public-1?checkoutKey=key-1', response)
		)

		expect(response.setHeader).toHaveBeenCalledWith(
			'x-cart-clear-public-key',
			'true'
		)
		expect(response.setHeader).toHaveBeenCalledWith(
			'x-cart-clear-checkout-key',
			'true'
		)
		expect(response.status).toHaveBeenCalledWith(404)
		expect(response.json).toHaveBeenCalledWith(
			expect.objectContaining({
				statusCode: 404,
				message: 'Корзина не найдена',
				clearCartKeys: ['publicKey', 'checkoutKey']
			})
		)
	})

	it('does not mark non-public cart not found responses', () => {
		const filter = new GlobalExceptionFilter()
		const response = {
			setHeader: jest.fn(),
			status: jest.fn().mockReturnThis(),
			json: jest.fn()
		}

		filter.catch(
			new NotFoundException('Корзина не найдена'),
			createHost('/cart/current', response)
		)

		expect(response.setHeader).not.toHaveBeenCalledWith(
			'x-cart-clear-public-key',
			'true'
		)
		expect(response.setHeader).not.toHaveBeenCalledWith(
			'x-cart-clear-checkout-key',
			'true'
		)
		expect(response.json).toHaveBeenCalledWith(
			expect.not.objectContaining({
				clearCartKeys: expect.anything()
			})
		)
	})
})
