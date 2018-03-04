const express = require('express');
const bodyParser = require('body-parser');
const karma = require('./src/karma');
const flatFile = require('./src/persistence/flat-file');
const expressWs = require('express-ws');

class RepositoryStrategy extends karma.RepositoryStrategy {
  onAccess(unit, repository) {
    unit.takeSnapshot();
    repository.remove(unit);
  }
}

const domain = new karma.Module(
  new flatFile.EventLog('./data'),
  new flatFile.SnapshotStore('./data'),
  new RepositoryStrategy(),
  new flatFile.EventStore('./data'))

  .add(new karma.Aggregate('Bob')

    .initializing(function () {
      this.total = 0;
      this.limit = 5;
    })

    .executing('Foo', $=>$.target, function ({count}) {
      if (this.total + count > this.limit) {
        throw new Error('Too much');
      }
      return [
        new karma.Event('food', {count, total: this.total + count}),
      ]
    })

    .applying('food', function ({total}) {
      this.total = total;
    })

    .executing('Inc', $=>$.where, function ({by}) {
      return [new karma.Event('incd', {by})];
    })

    .applying('incd', function ({by}) {
      this.limit += by;
    }))

  .add(new karma.Projection('Alice')

    .initializing(function () {
      this.total = 0;
    })

    .applying('food', function ({count}) {
      console.log('food', count);
      this.total += count;
    })

    .respondingTo('Food', $=>$.of, function () {
      return this.total
    }));


var app = express();
app.use(bodyParser.json());
expressWs(app);

app.post('/:command', (req, res) => {
  domain.execute(new karma.Command(req.params.command, req.body, Math.round(Math.random() * 1000000)))
    .then(() => res.send({success: true}))
    .catch(e => res.send({error: e.message}))
});

app.get('/:query', (req, res) => {
  domain.respondTo(new karma.Query(req.params.query, req.query.$ ? JSON.parse(req.query.$) : req.query))
    .then(response => res.send({data: response}))
    .catch(e => res.send({error: e.message}))
});

app.ws('/:query', function (ws, req) {
  console.log('message');
  var query = new karma.Query(req.params.query, req.query.$ ? JSON.parse(req.query.$) : req.query);
  domain.subscribeTo(query, (response) => {
    console.log('response', response);
    ws.send(JSON.stringify({data: response}))
  }).then(subscription => ws.on('close', () => {
    console.log('closed');
    subscription.cancel()
  }));
});

var port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on port ${port}`));

