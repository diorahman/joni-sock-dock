FROM debian:jessie
MAINTAINER Dhi Aurrahman

RUN echo "deb http://kambing.ui.ac.id/debian/ jessie main" > /etc/apt/sources.list
RUN apt update
RUN apt install -y g++ make
RUN mkdir /src
WORKDIR /src
ADD https://gist.githubusercontent.com/diorahman/579c7abd75b5fa7dee86/raw/260e079c9edeeaacb4e89ba678d2306c81f1c12d/Makefile /src/Makefile 

