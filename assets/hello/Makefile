CPPFLAGS = "-I./"

SOURCES = $(wildcard *.cpp)
OBJECTS = $(addsuffix .o, $(basename $(SOURCES)))
all: app
app: $(OBJECTS)
	$(CXX) -o app *.o

run: app 
	./app

clean: 
	rm -fr *.o app
