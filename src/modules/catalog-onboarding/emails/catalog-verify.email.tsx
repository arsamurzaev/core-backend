import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Preview,
	Section,
	Text
} from '@react-email/components'
import React from 'react'

type CatalogVerifyEmailProps = {
	fullName: string
	catalogName: string
	confirmUrl: string
	fqdn: string
	expiresInHours: number
}

export function CatalogVerifyEmail({
	fullName,
	catalogName,
	confirmUrl,
	fqdn,
	expiresInHours
}: CatalogVerifyEmailProps) {
	return (
		<Html>
			<Head />
			<Preview>Подтвердите почту для создания каталога {fqdn}</Preview>
			<Body style={styles.body}>
				<Container style={styles.container}>
					<Heading style={styles.heading}>Подтвердите аккаунт</Heading>
					<Text style={styles.text}>Здравствуйте, {fullName}.</Text>
					<Text style={styles.text}>
						Вы начали создание каталога {catalogName} на домене {fqdn}.
					</Text>
					<Section style={styles.buttonWrap}>
						<Button href={confirmUrl} style={styles.button}>
							Подтвердить почту
						</Button>
					</Section>
					<Text style={styles.text}>
						Ссылка действует {expiresInHours} часа. Если вы не создавали каталог,
						просто игнорируйте это письмо.
					</Text>
					<Hr style={styles.hr} />
					<Text style={styles.small}>{confirmUrl}</Text>
				</Container>
			</Body>
		</Html>
	)
}

const styles = {
	body: {
		backgroundColor: '#f6f7f9',
		fontFamily: 'Arial, sans-serif',
		margin: 0
	},
	container: {
		backgroundColor: '#ffffff',
		borderRadius: '8px',
		margin: '32px auto',
		padding: '28px',
		width: '560px'
	},
	heading: {
		color: '#111827',
		fontSize: '24px',
		lineHeight: '32px',
		margin: '0 0 18px'
	},
	text: {
		color: '#374151',
		fontSize: '16px',
		lineHeight: '24px',
		margin: '0 0 14px'
	},
	buttonWrap: {
		margin: '24px 0'
	},
	button: {
		backgroundColor: '#111827',
		borderRadius: '6px',
		color: '#ffffff',
		display: 'inline-block',
		fontSize: '16px',
		fontWeight: 700,
		padding: '12px 18px',
		textDecoration: 'none'
	},
	hr: {
		borderColor: '#e5e7eb',
		margin: '24px 0'
	},
	small: {
		color: '#6b7280',
		fontSize: '12px',
		lineHeight: '18px',
		wordBreak: 'break-all' as const
	}
}
