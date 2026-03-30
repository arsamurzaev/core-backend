/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import type { MediaDto } from '@/shared/media/dto/media.dto.res'
import type { MediaRecord } from '@/shared/media/media-url.service'

type CatalogMapMedia = (media: MediaRecord) => MediaDto

export function mapCatalogRecord(catalog: any, mapMedia: CatalogMapMedia): any {
	if (!catalog) return catalog

	let result = catalog
	if (result.config) {
		const config = result.config
		const hasLogo = Object.prototype.hasOwnProperty.call(config, 'logoMedia')
		const hasBg = Object.prototype.hasOwnProperty.call(config, 'bgMedia')
		if (hasLogo || hasBg) {
			result = {
				...result,
				config: {
					...config,
					logoMedia: config.logoMedia ? mapMedia(config.logoMedia) : null,
					bgMedia: config.bgMedia ? mapMedia(config.bgMedia) : null
				}
			}
		}
	}

	if (Object.prototype.hasOwnProperty.call(result, 'seoSettings')) {
		const seoCandidate = Array.isArray(result.seoSettings)
			? result.seoSettings.find((item: any) => item?.entityId === result.id) ??
				result.seoSettings[0] ??
				null
			: null

		result = {
			...result,
			seo: seoCandidate
				? {
						...seoCandidate,
						ogMedia: seoCandidate.ogMedia ? mapMedia(seoCandidate.ogMedia) : null,
						twitterMedia: seoCandidate.twitterMedia
							? mapMedia(seoCandidate.twitterMedia)
							: null
					}
				: null
		}

		delete result.seoSettings
	}

	const type = result.type
	if (type?.attributes?.length) {
		const attributes = type.attributes.map((attribute: any) => {
			const typeIds = Array.isArray(attribute.types)
				? attribute.types.map((item: any) => item.id)
				: attribute.typeId
					? [attribute.typeId]
					: []
			const nextAttribute = { ...attribute, typeIds }
			delete nextAttribute.types
			delete nextAttribute.typeId
			return nextAttribute
		})
		result = {
			...result,
			type: {
				...type,
				attributes
			}
		}
	}

	return result
}
