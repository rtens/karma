const express = require('express');
const bodyParser = require('body-parser');
const karma = require('./src/karma');
const flatFile = require('./src/persistence/flat-file');

class RepositoryStrategy extends karma.RepositoryStrategy {
  onAccess(repository, unit) {
    unit.takeSnapshot();
    repository.remove(unit);
  }
}

const domain = new karma.Domain('Test',
  new flatFile.EventBus('Test', './data'),
  new flatFile.EventStore('Test', './data'),
  new flatFile.SnapshotStore('Test', './data'),
  new RepositoryStrategy())

  .add(new karma.Aggregate('MyAggregate')

    .initializing(function () {
      this.total = 0;
      this.limit = 5;
    })

    .executing('Foo', e=>e.payload.target, function ({payload:{target, count}}) {
      if (this.total + count > this.limit) {
        throw new Error('Too much');
      }
      return [new karma.Event('food', {to: target, count, total: this.total + count})]
    })

    .applying('food', e=>e.payload.to, function ({payload:{total}}) {
      this.total = total;
    })

    .executing('Inc', e=>e.payload.where, function ({payload:{where, by}}) {
      return [new karma.Event('incd', {in: where, by})];
    })

    .applying('incd', e=>e.payload.in, function ({payload:{by}}) {
      this.limit += by;
    }))

  .add(new karma.Projection('MyProjection')

    .initializing(function () {
      this.total = 0;
    })

    .applying('food', 'Test', function ({payload:{count}}) {
      this.total += count;
    })

    .respondingTo('Food', q=>q.payload.of, function () {
      return this.total
    }));


var app = express();
app.use(bodyParser.json());

app.post('/:command', (req, res) => {
  domain.execute(new karma.Command(req.params.command, req.body, Math.round(Math.random() * 1000000)))
    .then(() => res.send({success: true}))
    .catch(e => res.send({error: e.message}))
});

app.get('/:query', (req, res) => {
  domain.respondTo(new karma.Query(req.params.query, req.query))
    .then(response => res.send({data: response}))
    .catch(e => res.send({error: e.message}))
});

var port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on port ${port}`));

