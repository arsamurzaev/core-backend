import {
	IsBooleanString,
	IsInt,
	IsOptional,
	IsString,
	Max,
	Min
} from 'class-validator'

export class S3Validator {
	@IsOptional()
	@IsBooleanString()
	S3_ENABLED?: string

	@IsOptional()
	@IsString()
	S3_REGION?: string

	@IsOptional()
	@IsString()
	S3_BUCKET?: string

	@IsOptional()
	@IsString()
	S3_ACCESS_KEY_ID?: string

	@IsOptional()
	@IsString()
	S3_SECRET_ACCESS_KEY?: string

	@IsOptional()
	@IsString()
	S3_ENDPOINT?: string

	@IsOptional()
	@IsString()
	S3_PUBLIC_URL?: string

	@IsOptional()
	@IsBooleanString()
	S3_FORCE_PATH_STYLE?: string

	@IsOptional()
	@IsBooleanString()
	S3_PUBLIC_READ?: string

	@IsOptional()
	@IsBooleanString()
	S3_STORE_ORIGINAL?: string

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(100)
	S3_IMAGE_QUALITY?: number

	@IsOptional()
	@IsString()
	S3_IMAGE_VARIANTS?: string

	@IsOptional()
	@IsString()
	S3_IMAGE_FORMATS?: string

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(51200)
	S3_MAX_FILE_MB?: number

	@IsOptional()
	@IsInt()
	@Min(60)
	@Max(86400)
	S3_PRESIGN_EXPIRES_SEC?: number
}
