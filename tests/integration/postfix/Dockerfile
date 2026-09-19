# Postfix en frontal de soumission SMTP, authentification déléguée à Dovecot (SASL, socket
# TCP `inet_listener`) — voir docker-compose.postfix.yml et docs/admin/connexion-unique.md,
# §Postfix (soumission SMTP). Image de base Debian minimale, installation non interactive.
FROM debian:bookworm-slim

RUN echo "postfix postfix/main_mailer_type select No configuration" | debconf-set-selections && \
    echo "postfix postfix/mailname string colombe-test.example" | debconf-set-selections && \
    DEBIAN_FRONTEND=noninteractive apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postfix openssl && \
    rm -rf /var/lib/apt/lists/*

# Certificat auto-signé pour STARTTLS (comme l'image dovecot/dovecot:2.4.1 des autres bancs).
RUN openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
      -keyout /etc/postfix/postfix.key -out /etc/postfix/postfix.crt \
      -subj "/CN=localhost" && \
    chmod 600 /etc/postfix/postfix.key

COPY main.cf /etc/postfix/main.cf
COPY master.cf /etc/postfix/master.cf

EXPOSE 587

CMD ["postfix", "start-fg"]
