import type { ExecutionContext } from '@nestjs/common'

import {
	AuthThrottle,
	shouldApplyAuthThrottle
} from './auth-throttle.decorator'

class TestController {
	@AuthThrottle()
	login() {
		return true
	}

	profile() {
		return true
	}
}

function createContext(methodName: keyof TestController): ExecutionContext {
	return {
		getClass: () => TestController,
		getHandler: () =>
			TestController.prototype[methodName] as (...args: any[]) => any
	} as ExecutionContext
}

describe('AuthThrottle', () => {
	it('applies auth throttle only to decorated handlers', () => {
		expect(shouldApplyAuthThrottle(createContext('login'))).toBe(true)
		expect(shouldApplyAuthThrottle(createContext('profile'))).toBe(false)
	})
})
