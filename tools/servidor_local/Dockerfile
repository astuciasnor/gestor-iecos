# Copia local do servidor da UFPA (Apache + PHP 8.2 com mysqli), so para testes.
FROM php:8.2-apache
RUN docker-php-ext-install mysqli \
 && sed -ri 's#(<Directory /var/www/>[^<]*AllowOverride) None#\1 All#' /etc/apache2/apache2.conf \
 && sed -ri '/<Directory \/var\/www\/>/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf
# Firewall igual ao do servidor da UFPA: ModSecurity com a configuracao
# recomendada. Envios acima de 128 KB -> 413; JSON com 1000 campos ou mais -> 400.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libapache2-mod-security2 \
 && rm -rf /var/lib/apt/lists/* \
 && sed 's/^SecRuleEngine DetectionOnly/SecRuleEngine On/' /etc/modsecurity/modsecurity.conf-recommended > /etc/modsecurity/modsecurity.conf \
 && a2enmod security2
# O servidor da UFPA tambem barra qualquer envio acima de 128 KB (413), seja qual for o tipo.
RUN echo 'LimitRequestBody 131072' > /etc/apache2/conf-enabled/limite-ufpa.conf
