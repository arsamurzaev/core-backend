import { Transform } from 'class-transformer'
import {
	IsNotEmpty,
	IsString,
	Matches,
	MaxLength,
	MinLength
} from 'class-validator'

const CODE_PATTERN = /^[a-z0-9-]+$/

export class UpdateTypeDtoReq {
	@IsString({ message: 'РўРёРї РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ СЃС‚СЂРѕРєРѕРёМ†' })
	@IsNotEmpty({ message: 'РРјСЏ С‚РёРїР° РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј' })
	@MaxLength(255)
	@Transform(({ value }) => String(value).trim().toLowerCase())
	name: string

	@IsString({ message: 'РџСЂРѕРіСЂР°РјРјРЅС‹Р№ РєРѕРґ РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ СЃС‚СЂРѕРєРѕРёМ†' })
	@IsNotEmpty({ message: 'РџСЂРѕРіСЂР°РјРјРЅС‹Р№ РєРѕРґ С‚РёРїР° РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј' })
	@MinLength(2)
	@MaxLength(50)
	@Matches(CODE_PATTERN)
	@Transform(({ value }) => String(value).trim().toLowerCase())
	code: string
}