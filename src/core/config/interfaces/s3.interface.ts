export interface S3Interface {
	enabled: boolean
	region?: string
	bucket?: string
	accessKeyId?: string
	secretAccessKey?: string
	endpoint?: string | null
	publicUrl?: string | null
	forcePathStyle: boolean
	publicRead: boolean
	imageQuality: number
	imageVariants: number[]
	imageFormats: string[]
	maxFileSizeMb: number
	storeOriginal: boolean
	presignExpiresSec: number
}
