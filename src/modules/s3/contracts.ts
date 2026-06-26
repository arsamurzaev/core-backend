export const MEDIA_STORAGE_PORT = Symbol('MEDIA_STORAGE_PORT')

export type MediaImageVariant = {
	name: string
	width: number
	key: string
	url: string
	height: number
	size: number
	contentType: string
}

export type UploadImageOptions = {
	path?: string
	folder?: string
	entityId?: string
	catalogId?: string
}

export type UploadedImageFile = {
	buffer: Buffer
	size: number
	mimetype: string
	originalname?: string
}

export type UploadImageResult = {
	ok: true
	mediaId: string
	key: string
	url: string
	variants: MediaImageVariant[]
}

export type UploadGeneratedAsset = {
	buffer: Buffer
	contentType: string
	originalName?: string
	size?: number
	width?: number
	height?: number
}

export type UploadGeneratedAssetResult = {
	ok: true
	mediaId: string
	key: string
	url: string
}

export type CopyObjectToCatalogParams = {
	sourceKey: string
	targetCatalogId: string
	path?: string | null
	folder?: string | null
	entityId?: string | null
}

export type CopyObjectToCatalogResult = {
	ok: true
	key: string
	url: string
}

export type MediaStorageDownloadResult = {
	buffer: Buffer
	contentType?: string
	size?: number
}

export interface MediaStoragePort {
	uploadImage(
		file: UploadedImageFile,
		options?: UploadImageOptions
	): Promise<UploadImageResult>
	uploadGeneratedAsset(
		asset: UploadGeneratedAsset,
		options: UploadImageOptions & { filename: string }
	): Promise<UploadGeneratedAssetResult>
	downloadObject(key: string): Promise<MediaStorageDownloadResult>
	copyObjectToCatalog(
		params: CopyObjectToCatalogParams
	): Promise<CopyObjectToCatalogResult>
	uploadProofFile(
		buffer: Buffer,
		mimeType: string,
		originalName?: string
	): Promise<{ url: string }>
	deleteObjectsByKeys(keys: string[]): Promise<void>
}
