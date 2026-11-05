# Copia local do servidor da UFPA (Apache + PHP 8.2 com mysqli), so para testes.
FROM php:8.2-apache
RUN docker-php-ext-install mysqli \
 && sed -ri 's#(<Directory /var/www/>[^<]*AllowOverride) None#\1 All#' /etc/apache2/apache2.conf \
 && sed -ri '/<Directory \/var\/www\/>/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf
# Igual ao servidor da UFPA: envios maiores que 128 KB sao recusados (erro 413).
RUN echo 'LimitRequestBody 131072' > /etc/apache2/conf-enabled/limite-ufpa.conf
