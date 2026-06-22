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

type CatalogAccessEmailProps = {
	fullName: string
	catalogName: string
	login: string
	password: string
	catalogUrl: string
	loginUrl: string
}

export function CatalogAccessEmail({
	fullName,
	catalogName,
	login,
	password,
	catalogUrl,
	loginUrl
}: CatalogAccessEmailProps) {
	return (
		<Html>
			<Head />
			<Preview>Данные для входа в каталог {catalogName}</Preview>
			<Body style={styles.body}>
				<Container style={styles.container}>
					<Heading style={styles.heading}>Каталог создан</Heading>
					<Text style={styles.text}>Здравствуйте, {fullName}.</Text>
					<Text style={styles.text}>
						Ваш каталог {catalogName} готов. Используйте данные ниже для входа.
					</Text>
					<Section style={styles.credentials}>
						<Text style={styles.credentialLine}>Логин: {login}</Text>
						<Text style={styles.credentialLine}>Временный пароль: {password}</Text>
					</Section>
					<Section style={styles.buttonWrap}>
						<Button href={loginUrl} style={styles.button}>
							Войти в кабинет
						</Button>
					</Section>
					<Text style={styles.text}>
						После входа вы будете перенаправлены в свой каталог. Смените временный
						пароль в настройках безопасности.
					</Text>
					<Hr style={styles.hr} />
					<Text style={styles.small}>Вход: {loginUrl}</Text>
					<Text style={styles.small}>Каталог: {catalogUrl}</Text>
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
	credentials: {
		backgroundColor: '#f3f4f6',
		borderRadius: '6px',
		margin: '18px 0',
		padding: '16px'
	},
	credentialLine: {
		color: '#111827',
		fontFamily: 'Arial, sans-serif',
		fontSize: '16px',
		fontWeight: 700,
		lineHeight: '24px',
		margin: '0 0 8px'
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
