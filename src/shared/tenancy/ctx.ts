import { ForbiddenException } from '@nestjs/common'

import { RequestContext } from './request-context'

export const ctx = () => RequestContext.mustGet()

export const mustCatalogId = (): string => {
	const id = RequestContext.mustGet().catalogId
	if (!id) throw new Error('RequestContext catalogId is missing')
	return id
}

export const mustTypeId = (): string => {
	const id = RequestContext.mustGet().typeId
	if (!id) throw new Error('RequestContext typeId is missing')
	return id
}

export const isChildCatalogContext = (): boolean => {
	const store = RequestContext.mustGet()
	return Boolean(store.parentId && store.parentId !== store.catalogId)
}

export const isBusinessCardCatalogContext = (): boolean => {
	return RequestContext.mustGet().presentationMode === 'BUSINESS_CARD'
}

export const assertCurrentCatalogCanManageCatalogContent = (): void => {
	if (isChildCatalogContext()) {
		throw new ForbiddenException(
			'Дочерний каталог не может управлять товарами, категориями, брендами и справочниками каталога'
		)
	}

	if (isBusinessCardCatalogContext()) {
		throw new ForbiddenException(
			'Business card catalog mode allows only profile and contact management'
		)
	}
}

export const effectiveCatalogId = (): string => {
	const store = RequestContext.mustGet()
	const id = store.parentId ?? store.catalogId
	if (!id) throw new Error('RequestContext catalogId is missing')
	return id
}
