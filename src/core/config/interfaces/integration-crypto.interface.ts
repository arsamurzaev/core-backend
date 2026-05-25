export interface IntegrationCryptoInterface {
	encryptionKey: string
	keyVersion: string
	payloadPrivateKey: string | null
	payloadPublicKey: string | null
	payloadKeyId: string
}
