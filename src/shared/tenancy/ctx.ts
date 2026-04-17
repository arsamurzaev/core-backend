import { RequestContext } from './request-context'

export const ctx = () => RequestContext.mustGet()

export const mustCatalogId = (): string => {
	const id = RequestContext.mustGet().catalogId
	if (!id) throw new Error('В RequestContext отсутствует catalogId')
	return id
}

export const mustTypeId = (): string => {
	const id = RequestContext.mustGet().typeId
	if (!id) throw new Error('В RequestContext отсутствует typeId')
	return id
}

/**
 * Возвращает catalogId родителя если текущий каталог является дочерним,
 * иначе возвращает catalogId текущего каталога.
 *
 * Используется в read-методах для прозрачного наследования товаров,
 * категорий и брендов от родительского каталога.
 */
export const effectiveCatalogId = (): string => {
	const store = RequestContext.mustGet()
	const id = store.parentId ?? store.catalogId
	if (!id) throw new Error('В RequestContext отсутствует catalogId')
	return id
}
