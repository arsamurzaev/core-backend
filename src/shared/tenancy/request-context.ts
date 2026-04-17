import { AsyncLocalStorage } from 'node:async_hooks'

export type RequestContextStore = {
	requestId: string
	host: string

	// tenancy
	catalogId?: string
	catalogSlug?: string
	typeId?: string

	ownerUserId?: string | null

	// Если каталог является дочерним — id родительского каталога.
	// Используется для наследования товаров, категорий и брендов.
	parentId?: string | null

	// bypass tenant scoping for SkipCatalog routes
	skipCatalog?: boolean
}

export class RequestContext {
	private static readonly als = new AsyncLocalStorage<RequestContextStore>()

	static run<T>(store: RequestContextStore, fn: () => T): T {
		return this.als.run(store, fn)
	}

	static get(): RequestContextStore | undefined {
		return this.als.getStore()
	}

	static mustGet(): RequestContextStore {
		const store = this.get()
		if (!store) {
			throw new Error(
				'RequestContext не инициализирован. Вы забыли применить CatalogContextMiddleware глобально?'
			)
		}
		return store
	}

	static patch(patch: Partial<RequestContextStore>): void {
		const store = this.mustGet()
		Object.assign(store, patch)
	}
}
