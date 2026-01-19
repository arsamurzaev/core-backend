import { RequestContext } from './request-context'

export const ctx = () => RequestContext.mustGet()

export const mustCatalogId = (): string => {
	const id = RequestContext.mustGet().catalogId
	if (!id) throw new Error('catalogId is missing in RequestContext')
	return id
}

export const mustTypeId = (): string => {
	const id = RequestContext.mustGet().typeId
	if (!id) throw new Error('typeId is missing in RequestContext')
	return id
}
